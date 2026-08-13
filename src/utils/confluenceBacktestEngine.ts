import type { Candle } from "../adapters/IDataAdapter";
import {
  detectFVGs,
  detectOrderBlocks,
  detectMarketStructure,
  detectLiquidityPools,
  detectPremiumDiscount,
  detectSupplyDemandZones,
  detectTrendlineLiquidity,
  detectCandlestickPatterns,
} from "./smcEngine";
import {
  detectICTSessions,
  detectSilverBulletWindows,
  detectICTOTEZone,
  detectJudasSwings,
  detectAMDCycles,
} from "./ictEngine";
import { scanSetups, type SetupScanInput } from "./setupScanner";

export interface ConfluenceBacktestTrade {
  id: number;
  entryTime: number;
  exitTime: number;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  targetPrice: number;
  pnlPct: number;
  exitReason: "STOP_LOSS" | "TAKE_PROFIT";
  alignedCount: number;
  notes: string[];
}

export interface ConfluenceBacktestSummary {
  initialEquity: number;
  finalEquity: number;
  netProfitPct: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  equityCurve: { time: number; equity: number }[];
  trades: ConfluenceBacktestTrade[];
}

export interface ConfluenceBacktestOptions {
  /** Bars to skip before the first scan, so detectors have history to work with. */
  warmupBars?: number;
  /** Rolling lookback window fed to the detectors at each bar. */
  windowBars?: number;
  initialEquity?: number;
  /** Fraction of equity risked per trade, sized off the signal's stop distance. */
  riskPctPerTrade?: number;
}

interface OpenPosition {
  side: "LONG" | "SHORT";
  entryTime: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  alignedCount: number;
  notes: string[];
}

function buildSetupInput(window: Candle[], symbol: string): SetupScanInput {
  return {
    lastPrice: window[window.length - 1].close,
    fvg: detectFVGs(window),
    ob: detectOrderBlocks(window),
    structure: detectMarketStructure(window),
    liquidity: detectLiquidityPools(window),
    pd: detectPremiumDiscount(window),
    sessions: detectICTSessions(window),
    sb: detectSilverBulletWindows(window),
    ote: detectICTOTEZone(window),
    judas: detectJudasSwings(window),
    amd: detectAMDCycles(window),
    sd: detectSupplyDemandZones(window),
    tl: detectTrendlineLiquidity(window),
    cp: detectCandlestickPatterns(window),
    symbol,
  };
}

function tryOpenPosition(bar: Candle, window: Candle[], symbol: string): OpenPosition | null {
  const signal = scanSetups(buildSetupInput(window, symbol), bar.time);
  if (signal.direction === "NO_TRADE" || !signal.recommendedEntry) return null;

  const { side, entry, stop, target } = signal.recommendedEntry;
  return {
    side,
    entryTime: bar.time,
    entryPrice: entry.price,
    stopPrice: stop.price,
    targetPrice: target.price,
    alignedCount: signal.alignedCount,
    notes: signal.notes,
  };
}

function checkExit(
  bar: Candle,
  position: OpenPosition
): { exitPrice: number; exitReason: "STOP_LOSS" | "TAKE_PROFIT" } | null {
  const hitStop = position.side === "LONG" ? bar.low <= position.stopPrice : bar.high >= position.stopPrice;
  const hitTarget = position.side === "LONG" ? bar.high >= position.targetPrice : bar.low <= position.targetPrice;

  // Stop-first convention when both trigger within the same bar (conservative).
  if (hitStop) return { exitPrice: position.stopPrice, exitReason: "STOP_LOSS" };
  if (hitTarget) return { exitPrice: position.targetPrice, exitReason: "TAKE_PROFIT" };
  return null;
}

function pnlPctFor(position: OpenPosition, exitPrice: number): number {
  const raw =
    position.side === "LONG"
      ? (exitPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - exitPrice) / position.entryPrice;
  return Number((raw * 100).toFixed(3));
}

function closePosition(
  bar: Candle,
  position: OpenPosition,
  equity: number,
  riskPctPerTrade: number
): { trade: ConfluenceBacktestTrade; newEquity: number } | null {
  const exit = checkExit(bar, position);
  if (!exit) return null;

  const pnlPct = pnlPctFor(position, exit.exitPrice);
  const stopDistPct = Math.abs(position.entryPrice - position.stopPrice) / position.entryPrice;
  const notional = stopDistPct > 0 ? (equity * riskPctPerTrade) / stopDistPct : 0;
  const newEquity = equity + (pnlPct / 100) * notional;

  return {
    newEquity,
    trade: {
      id: 0,
      entryTime: position.entryTime,
      exitTime: bar.time,
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice: exit.exitPrice,
      stopPrice: position.stopPrice,
      targetPrice: position.targetPrice,
      pnlPct,
      exitReason: exit.exitReason,
      alignedCount: position.alignedCount,
      notes: position.notes,
    },
  };
}

function summarize(
  trades: ConfluenceBacktestTrade[],
  initialEquity: number,
  finalEquity: number,
  maxDrawdownPct: number
): Omit<ConfluenceBacktestSummary, "equityCurve" | "trades"> {
  const winCount = trades.filter((t) => t.pnlPct > 0).length;
  const lossCount = trades.filter((t) => t.pnlPct <= 0).length;
  const grossWin = trades.filter((t) => t.pnlPct > 0).reduce((a, t) => a + t.pnlPct, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnlPct < 0).reduce((a, t) => a + t.pnlPct, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 5 : 1;

  return {
    initialEquity,
    finalEquity: Number(finalEquity.toFixed(2)),
    netProfitPct: Number((((finalEquity - initialEquity) / initialEquity) * 100).toFixed(2)),
    totalTrades: trades.length,
    winCount,
    lossCount,
    winRatePct: trades.length > 0 ? Number(((winCount / trades.length) * 100).toFixed(1)) : 0,
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
  };
}

/**
 * Walks candles bar-by-bar through scanSetups() (the confluence engine that already
 * fuses every SMC/ICT signal) and simulates trades against its recommended stop/target.
 */
export function runConfluenceBacktest(
  candles: Candle[],
  symbol: string,
  options: ConfluenceBacktestOptions = {}
): ConfluenceBacktestSummary {
  const warmupBars = options.warmupBars ?? 200;
  const windowBars = options.windowBars ?? 300;
  const initialEquity = options.initialEquity ?? 10000;
  const riskPctPerTrade = options.riskPctPerTrade ?? 0.02;

  const trades: ConfluenceBacktestTrade[] = [];
  const equityCurve: { time: number; equity: number }[] = [
    { time: candles[0]?.time ?? 0, equity: initialEquity },
  ];
  let equity = initialEquity;
  let peakEquity = initialEquity;
  let maxDrawdownPct = 0;
  let position: OpenPosition | null = null;

  for (let i = warmupBars; i < candles.length; i++) {
    const bar = candles[i];

    if (position) {
      const closed = closePosition(bar, position, equity, riskPctPerTrade);
      if (!closed) continue;

      equity = closed.newEquity;
      peakEquity = Math.max(peakEquity, equity);
      maxDrawdownPct = Math.max(maxDrawdownPct, ((peakEquity - equity) / peakEquity) * 100);
      trades.push({ ...closed.trade, id: trades.length + 1 });
      equityCurve.push({ time: bar.time, equity: Number(equity.toFixed(2)) });
      position = null;
      continue;
    }

    const window = candles.slice(Math.max(0, i - windowBars), i + 1);
    position = tryOpenPosition(bar, window, symbol);
  }

  return { ...summarize(trades, initialEquity, equity, maxDrawdownPct), equityCurve, trades };
}
