import type { Candle } from "../adapters/IDataAdapter";
import {
  RiftBar,
  RiftProfileStats,
  RiftDecision,
  RiftSignal,
  RiftTradeBox,
  RiftConfig,
  DEFAULT_RIFT_CONFIG,
  calculateAtr,
  RiftVolumeProfile,
} from "./riftEngine";
import { RiftSignalEngine, RiftLiquidityRails } from "./riftSignals";

export interface RiftAnalysisResult {
  stats: RiftProfileStats | null;
  latestSignal: RiftSignal | null;
  tradeBoxes: RiftTradeBox[];
  rails: any[];
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  netProfitPct: number;
}

export class RiftPaperEngine {
  private cfg: RiftConfig;
  public tradeBoxes: RiftTradeBox[] = [];
  public activeBox: RiftTradeBox | null = null;
  public wins = 0;
  public losses = 0;
  public netPnlUsdt = 0;

  constructor(cfg: RiftConfig = DEFAULT_RIFT_CONFIG) {
    this.cfg = cfg;
  }

  public frameSignal(
    sym: string,
    dec: RiftDecision,
    bar: RiftBar,
    atrVal: number | null,
    ps: RiftProfileStats | null
  ): RiftSignal | null {
    if (!atrVal) return null;
    const entry = bar.close;
    let stop = 0;
    let target = 0;

    if (this.cfg.riskMode === "structure" && ps) {
      const buf = this.cfg.structBufferAtr * atrVal;
      if (dec.side > 0) {
        stop = dec.nodePrice - buf;
        if (stop >= bar.close) stop = bar.low - buf;
        const candidates = [ps.pov, ps.poc, ps.vah].filter(
          (n): n is number => n !== null && n > entry + 0.15 * atrVal
        );
        target = candidates.length > 0 ? Math.min(...candidates) : entry + this.cfg.rr * Math.abs(entry - stop);
      } else {
        stop = dec.nodePrice + buf;
        if (stop <= bar.close) stop = bar.high + buf;
        const candidates = [ps.pov, ps.poc, ps.val].filter(
          (n): n is number => n !== null && n < entry - 0.15 * atrVal
        );
        target = candidates.length > 0 ? Math.max(...candidates) : entry - this.cfg.rr * Math.abs(entry - stop);
      }
    } else {
      // ATR Mode
      const extreme = dec.side > 0 ? bar.low : bar.high;
      stop = dec.side > 0 ? extreme - this.cfg.atrStopMult * atrVal : extreme + this.cfg.atrStopMult * atrVal;
      const risk = Math.abs(entry - stop);
      target = dec.side > 0 ? entry + this.cfg.rr * risk : entry - this.cfg.rr * risk;
    }

    const isValid = dec.side > 0 ? stop < entry && entry < target : target < entry && entry < stop;
    if (!isValid) return null;

    return {
      id: `sig_${sym}_${bar.time}_${dec.kind}`,
      symbol: sym,
      side: dec.side > 0 ? "LONG" : "SHORT",
      kind: dec.kind,
      node: dec.node,
      nodePrice: dec.nodePrice,
      entry,
      stop,
      target,
      time: bar.time,
      rMultiple: this.cfg.rr,
    };
  }

  public onSignal(sig: RiftSignal, bar: RiftBar): RiftTradeBox {
    if (this.activeBox) {
      this.closeBox(this.activeBox, bar.close, "OPP_CLOSE", bar.time);
    }
    const box: RiftTradeBox = {
      id: `box_${sig.symbol}_${bar.time}`,
      symbol: sig.symbol,
      side: sig.side,
      entryPrice: sig.entry,
      stopPrice: sig.stop,
      targetPrice: sig.target,
      entryTime: bar.time,
      state: "ACTIVE",
      kind: sig.kind,
      node: sig.node,
    };
    this.activeBox = box;
    this.tradeBoxes.push(box);
    return box;
  }

  public onBar(bar: RiftBar): void {
    if (!this.activeBox || this.activeBox.state !== "ACTIVE") return;
    const box = this.activeBox;

    if (box.side === "LONG") {
      const slHit = bar.low <= box.stopPrice;
      const tpHit = bar.high >= box.targetPrice;

      if (slHit && (!tpHit || this.cfg.stopFirst)) {
        this.closeBox(box, box.stopPrice, "SL_HIT", bar.time);
      } else if (tpHit) {
        this.closeBox(box, box.targetPrice, "TP_HIT", bar.time);
      }
    } else {
      const slHit = bar.high >= box.stopPrice;
      const tpHit = bar.low <= box.targetPrice;

      if (slHit && (!tpHit || this.cfg.stopFirst)) {
        this.closeBox(box, box.stopPrice, "SL_HIT", bar.time);
      } else if (tpHit) {
        this.closeBox(box, box.targetPrice, "TP_HIT", bar.time);
      }
    }
  }

  private closeBox(box: RiftTradeBox, exitPx: number, state: RiftTradeBox["state"], time: number): void {
    box.state = state;
    box.exitPrice = exitPx;
    box.exitTime = time;

    const mult = box.side === "LONG" ? 1 : -1;
    const pnlPct = ((exitPx - box.entryPrice) / box.entryPrice) * 100 * mult;
    const pnlUsdt = (pnlPct / 100) * this.cfg.notionalUsdt;

    box.pnlPct = Number(pnlPct.toFixed(2));
    box.pnlUsdt = Number(pnlUsdt.toFixed(2));

    if (pnlPct >= 0) this.wins++;
    else this.losses++;
    this.netPnlUsdt += pnlUsdt;

    if (this.activeBox === box) this.activeBox = null;
  }
}

/**
 * Top-level runner to execute full Rift Volume-and-Structure analysis.
 */
export function runRiftAnalysis(
  candles: Candle[],
  sym: string = "BTCUSDT",
  config: Partial<RiftConfig> = {}
): RiftAnalysisResult {
  const cfg: RiftConfig = { ...DEFAULT_RIFT_CONFIG, ...config };
  if (!candles || candles.length < 20) {
    return {
      stats: null,
      latestSignal: null,
      tradeBoxes: [],
      rails: [],
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      profitFactor: 1.0,
      netProfitPct: 0,
    };
  }

  const bars: RiftBar[] = candles.map((c) => ({
    time: Number(c.time),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume || 1),
  }));

  const atrVal = calculateAtr(bars, cfg.atrPeriod) || (bars[bars.length - 1].high - bars[bars.length - 1].low);
  const rowH = Math.max(0.01, atrVal / cfg.rowAtrDiv);

  const profile = new RiftVolumeProfile(cfg.valueAreaPct);
  const signals = new RiftSignalEngine(cfg);
  const rails = new RiftLiquidityRails(cfg.pivotLen, cfg.maxRails);
  const paper = new RiftPaperEngine(cfg);

  let prevClose: number | null = null;
  let latestSig: RiftSignal | null = null;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const buyVol = prevClose === null || b.close >= prevClose ? b.volume : 0;
    const sellVol = b.volume - buyVol;

    profile.onBar(b, buyVol, sellVol, rowH);
    paper.onBar(b);

    const ps = profile.getStats();
    rails.onClose(bars.slice(0, i + 1), b);

    const dec = signals.onClose(b, prevClose, bars.slice(0, i + 1), ps, buyVol - sellVol);
    if (dec) {
      const sig = paper.frameSignal(sym, dec, b, atrVal, ps);
      if (sig) {
        latestSig = sig;
        paper.onSignal(sig, b);
      }
    }
    prevClose = b.close;
  }

  const totalTrades = paper.tradeBoxes.filter((b) => b.state !== "ACTIVE").length;
  const winTrades = paper.wins;
  const lossTrades = paper.losses;
  const winRate = totalTrades > 0 ? (winTrades / totalTrades) * 100 : 0;

  const grossWin = paper.tradeBoxes
    .filter((b) => (b.pnlPct || 0) > 0)
    .reduce((acc, b) => acc + (b.pnlPct || 0), 0);
  const grossLoss = Math.abs(
    paper.tradeBoxes
      .filter((b) => (b.pnlPct || 0) < 0)
      .reduce((acc, b) => acc + (b.pnlPct || 0), 0)
  );

  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 5.0 : 1.0;
  const netProfitPct = Number((grossWin - grossLoss).toFixed(2));

  return {
    stats: profile.getStats(),
    latestSignal: latestSig,
    tradeBoxes: paper.tradeBoxes,
    rails: rails.rails,
    totalTrades,
    winningTrades: winTrades,
    losingTrades: lossTrades,
    winRate: Number(winRate.toFixed(1)),
    profitFactor: Number(Math.min(9.99, profitFactor).toFixed(2)),
    netProfitPct,
  };
}
