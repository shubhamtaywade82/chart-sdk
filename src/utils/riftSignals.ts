import { RiftBar, RiftProfileStats, RiftDecision, RiftRail, RiftRetestLevel, RiftConfig } from "./riftEngine";

/**
 * Signal Engine for The Three Hunts:
 * 1. Sweep & Reclaim (with optional CVD divergence gate)
 * 2. POC Bounce
 * 3. POV Void (breakout through the thin liquidity rift)
 */
export class RiftSignalEngine {
  private cfg: RiftConfig;
  private cvdHist: number[] = [];
  private fires: Map<string, { barIndex: number; nodePrice: number }> = new Map();
  private barIndex = 0;

  constructor(cfg: RiftConfig) {
    this.cfg = cfg;
  }

  public onClose(
    bar: RiftBar,
    prevClose: number | null,
    bars: RiftBar[],
    ps: RiftProfileStats | null,
    barDelta: number
  ): RiftDecision | null {
    this.barIndex++;
    if (!ps) return null;

    let dec: RiftDecision | null =
      this.checkSweep(bar, bars, ps) ||
      this.checkBounce(bar, ps) ||
      this.checkVoid(bar, prevClose, ps, barDelta);

    if (dec && !this.checkDedup(dec, ps)) dec = null;
    this.cvdHist.push(ps.cvd);
    if (this.cvdHist.length > this.cfg.cvdLookback) this.cvdHist.shift();

    return dec;
  }

  // Hunt 1: Sweep & Reclaim
  private checkSweep(bar: RiftBar, bars: RiftBar[], ps: RiftProfileStats): RiftDecision | null {
    const nodes: Array<["VAH" | "pVAH", number]> = [["VAH", ps.vah]];
    if (ps.prevVah) nodes.push(["pVAH", ps.prevVah]);

    for (const [node, px] of nodes) {
      if (bar.high > px && bar.close < px && this.checkCvdGate(-1, bar, bars, ps.cvd)) {
        return { side: -1, kind: "SWEEP", node, nodePrice: px };
      }
    }

    const valNodes: Array<["VAL" | "pVAL", number]> = [["VAL", ps.val]];
    if (ps.prevVal) valNodes.push(["pVAL", ps.prevVal]);

    for (const [node, px] of valNodes) {
      if (bar.low < px && bar.close > px && this.checkCvdGate(1, bar, bars, ps.cvd)) {
        return { side: 1, kind: "SWEEP", node, nodePrice: px };
      }
    }
    return null;
  }

  private checkCvdGate(side: 1 | -1, bar: RiftBar, bars: RiftBar[], currentCvd: number): boolean {
    if (!this.cfg.cvdGate || this.cvdHist.length < 5) return true;
    const lb = bars.slice(-this.cfg.cvdLookback);
    if (side < 0) {
      const maxHigh = Math.max(...lb.map((b) => b.high));
      const maxCvd = Math.max(...this.cvdHist);
      return bar.high >= maxHigh && currentCvd < maxCvd;
    }
    const minLow = Math.min(...lb.map((b) => b.low));
    const minCvd = Math.min(...this.cvdHist);
    return bar.low <= minLow && currentCvd > minCvd;
  }

  // Hunt 2: POC Bounce
  private checkBounce(bar: RiftBar, ps: RiftProfileStats): RiftDecision | null {
    if (bar.low <= ps.poc && ps.poc <= bar.high) {
      if (bar.close > ps.poc && bar.close > bar.open) {
        return { side: 1, kind: "BOUNCE", node: "POC", nodePrice: ps.poc };
      }
      if (bar.close < ps.poc && bar.close < bar.open) {
        return { side: -1, kind: "BOUNCE", node: "POC", nodePrice: ps.poc };
      }
    }
    return null;
  }

  // Hunt 3: POV Void
  private checkVoid(
    bar: RiftBar,
    prevClose: number | null,
    ps: RiftProfileStats,
    barDelta: number
  ): RiftDecision | null {
    if (ps.pov === null || prevClose === null) return null;
    if (prevClose <= ps.pov && ps.pov < bar.close && (!this.cfg.deltaConfirm || barDelta > 0)) {
      return { side: 1, kind: "VOID", node: "POV", nodePrice: ps.pov };
    }
    if (prevClose >= ps.pov && ps.pov > bar.close && (!this.cfg.deltaConfirm || barDelta < 0)) {
      return { side: -1, kind: "VOID", node: "POV", nodePrice: ps.pov };
    }
    return null;
  }

  private checkDedup(dec: RiftDecision, ps: RiftProfileStats): boolean {
    const key = `${dec.side}_${dec.kind}_${dec.node}`;
    const last = this.fires.get(key);
    if (last) {
      const dist = Math.abs(last.nodePrice - dec.nodePrice);
      if (dist <= ps.rowHeight && this.barIndex - last.barIndex < this.cfg.cooldownBars) {
        return false;
      }
    }
    this.fires.set(key, { barIndex: this.barIndex, nodePrice: dec.nodePrice });
    return true;
  }
}

/** Liquidity Rails manager for swing pivot highs & lows */
export class RiftLiquidityRails {
  private p: number;
  private maxRails: number;
  public rails: RiftRail[] = [];

  constructor(p: number = 5, maxRails: number = 6) {
    this.p = p;
    this.maxRails = maxRails;
  }

  public onClose(bars: RiftBar[], currentBar: RiftBar): RiftRail[] {
    const events: RiftRail[] = [];
    const n = bars.length;
    const c = n - 1 - this.p;
    if (c - this.p >= 0) {
      const w = bars.slice(c - this.p, c + this.p + 1);
      const b = bars[c];
      const maxH = Math.max(...w.map((x) => x.high));
      const minL = Math.min(...w.map((x) => x.low));

      if (b.high === maxH) this.addRail("H", b.high, currentBar.time);
      if (b.low === minL) this.addRail("L", b.low, currentBar.time);
    }

    for (const r of this.rails) {
      if (r.state !== "ALIVE") continue;
      if (r.kind === "H" && currentBar.high >= r.price) {
        r.state = currentBar.close < r.price ? "SWEPT" : "BREAK";
        r.sweptTime = currentBar.time;
        events.push(r);
      } else if (r.kind === "L" && currentBar.low <= r.price) {
        r.state = currentBar.close > r.price ? "SWEPT" : "BREAK";
        r.sweptTime = currentBar.time;
        events.push(r);
      }
    }
    return events;
  }

  private addRail(kind: "H" | "L", price: number, time: number): void {
    const alive = this.rails.filter((r) => r.state === "ALIVE" && r.kind === kind);
    if (alive.some((r) => Math.abs(r.price - price) < 1e-6)) return;
    if (alive.length >= this.maxRails) return;
    this.rails.push({ id: `rail_${kind}_${time}_${price.toFixed(2)}`, kind, price, time, state: "ALIVE" });
  }
}
