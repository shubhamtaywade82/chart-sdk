import type { Candle } from "../adapters/IDataAdapter";

export interface RiftBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RiftProfileStats {
  rowHeight: number;
  poc: number;
  vah: number;
  val: number;
  pov: number | null;
  totalVol: number;
  buyVol: number;
  sellVol: number;
  cvd: number;
  deltaPct: number;
  prevVah?: number | null;
  prevVal?: number | null;
  prevPoc?: number | null;
}

export interface RiftDecision {
  side: 1 | -1;
  kind: "SWEEP" | "BOUNCE" | "VOID";
  node: "VAH" | "VAL" | "pVAH" | "pVAL" | "POC" | "POV";
  nodePrice: number;
}

export interface RiftSignal {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  kind: "SWEEP" | "BOUNCE" | "VOID";
  node: string;
  nodePrice: number;
  entry: number;
  stop: number;
  target: number;
  time: number;
  rMultiple: number;
}

export interface RiftTradeBox {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  entryTime: number;
  exitTime?: number;
  exitPrice?: number;
  state: "ACTIVE" | "TP_HIT" | "SL_HIT" | "OPP_CLOSE";
  pnlPct?: number;
  pnlUsdt?: number;
  kind: string;
  node: string;
}

export interface RiftRail {
  id: string;
  kind: "H" | "L";
  price: number;
  time: number;
  state: "ALIVE" | "SWEPT" | "BREAK";
  sweptTime?: number;
}

export interface RiftRetestLevel {
  id: string;
  kind: string;
  side: "LONG" | "SHORT";
  price: number;
  time: number;
  state: "ALIVE" | "FILLED";
}

export interface RiftConfig {
  valueAreaPct: number;
  atrPeriod: number;
  rowAtrDiv: number;
  cooldownBars: number;
  cvdGate: boolean;
  cvdLookback: int;
  deltaConfirm: boolean;
  riskMode: "atr" | "structure";
  atrStopMult: number;
  rr: number;
  structBufferAtr: number;
  stopFirst: boolean;
  pivotLen: number;
  maxRails: number;
  notionalUsdt: number;
  feeRate: number;
}

type int = number;

export const DEFAULT_RIFT_CONFIG: RiftConfig = {
  valueAreaPct: 0.70,
  atrPeriod: 14,
  rowAtrDiv: 8.0,
  cooldownBars: 8,
  cvdGate: true,
  cvdLookback: 30,
  deltaConfirm: true,
  riskMode: "atr",
  atrStopMult: 1.5,
  rr: 2.0,
  structBufferAtr: 0.25,
  stopFirst: true,
  pivotLen: 5,
  maxRails: 6,
  notionalUsdt: 1000.0,
  feeRate: 0.0005,
};

/** Compute Wilder-smoothed ATR value */
export function calculateAtr(bars: RiftBar[], period: number = 14): number | null {
  if (!bars || bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const pb = bars[i - 1];
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - pb.close), Math.abs(b.low - pb.close)));
  }
  let a = trs.slice(0, period).reduce((acc, v) => acc + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    a = (a * (period - 1) + trs[i]) / period;
  }
  return a;
}

/**
 * Volume Profile Engine with per-row delta, POC, 70% Value Area, and Point of Void (POV).
 */
export class RiftVolumeProfile {
  private valuePct: number;
  public rowH: number | null = null;
  private currentDay: number | null = null;
  public rows: Map<number, [number, number, number]> = new Map(); // [total, buy, sell]
  public buy = 0;
  public sell = 0;
  public cvd = 0;
  public prev: [number | null, number | null, number | null] | null = null;
  private lastStats: RiftProfileStats | null = null;

  constructor(valuePct: number = 0.70) {
    this.valuePct = valuePct;
  }

  public onBar(bar: RiftBar, buy: number, sell: number, rowH: number): void {
    const day = Math.floor(bar.time / 86400);
    if (this.currentDay !== null && day !== this.currentDay) {
      if (this.lastStats) {
        this.prev = [this.lastStats.vah, this.lastStats.val, this.lastStats.poc];
      }
      this.rows.clear();
      this.buy = 0;
      this.sell = 0;
      this.cvd = 0;
    }
    this.currentDay = day;
    this.buy += buy;
    this.sell += sell;
    this.cvd += buy - sell;

    if (this.rowH === null || Math.abs(rowH - this.rowH) > 1e-9) {
      this.rowH = rowH;
      this.rows.clear();
    }
    this.addRowVolume(bar, buy, sell);
  }

  private addRowVolume(bar: RiftBar, buy: number, sell: number): void {
    if (!this.rowH || this.rowH <= 0) return;
    const lo = Math.floor(bar.low / this.rowH);
    const hi = Math.floor(bar.high / this.rowH);
    const count = Math.max(1, hi - lo + 1);
    const vb = buy / count;
    const vs = sell / count;

    for (let i = lo; i <= hi; i++) {
      const r = this.rows.get(i) || [0, 0, 0];
      r[0] += vb + vs;
      r[1] += vb;
      r[2] += vs;
      this.rows.set(i, r);
    }
  }

  public getStats(): RiftProfileStats | null {
    if (this.rows.size === 0 || !this.rowH) return null;
    const total = this.buy + this.sell;
    if (total <= 0) return null;

    let maxVol = -1;
    let pocIdx = 0;
    for (const [idx, r] of this.rows.entries()) {
      if (r[0] > maxVol) {
        maxVol = r[0];
        pocIdx = idx;
      }
    }

    const indices = Array.from(this.rows.keys()).sort((a, b) => a - b);
    const minIdx = indices[0];
    const maxIdx = indices[indices.length - 1];

    let vaVol = this.rows.get(pocIdx)?.[0] || 0;
    let lo = pocIdx;
    let hi = pocIdx;
    const targetVol = this.valuePct * total;

    while (vaVol < targetVol && (lo > minIdx || hi < maxIdx)) {
      const upVol = hi + 1 <= maxIdx ? this.rows.get(hi + 1)?.[0] || 0 : -1;
      const dnVol = lo - 1 >= minIdx ? this.rows.get(lo - 1)?.[0] || 0 : -1;
      if (upVol >= dnVol) {
        hi++;
        vaVol += Math.max(0, upVol);
      } else {
        lo--;
        vaVol += Math.max(0, dnVol);
      }
    }

    let povPrice: number | null = null;
    if (hi - lo >= 2) {
      let minRowVol = Infinity;
      let minRowIdx = pocIdx;
      for (let i = lo + 1; i < hi; i++) {
        const v = this.rows.get(i)?.[0] || 0;
        if (v < minRowVol) {
          minRowVol = v;
          minRowIdx = i;
        }
      }
      povPrice = (minRowIdx + 0.5) * this.rowH;
    }

    const pv = this.prev || [null, null, null];
    const deltaPct = total > 0 ? ((this.buy - this.sell) / total) * 100 : 0;

    const stats: RiftProfileStats = {
      rowHeight: this.rowH,
      poc: (pocIdx + 0.5) * this.rowH,
      vah: (hi + 1) * this.rowH,
      val: lo * this.rowH,
      pov: povPrice,
      totalVol: total,
      buyVol: this.buy,
      sellVol: this.sell,
      cvd: this.cvd,
      deltaPct,
      prevVah: pv[0],
      prevVal: pv[1],
      prevPoc: pv[2],
    };
    this.lastStats = stats;
    return stats;
  }
}
