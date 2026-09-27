import { DepthLevel, OrderBookState } from "./types";

export interface DepthEvent {
  U: number;
  u: number;
  pu: number;
  bids: [string, string][];
  asks: [string, string][];
}

export interface DepthSnapshotRaw {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

export type ApplyResult = "applied" | "dropped" | "gap";

function applyLevels(levels: [string, string][], book: Map<number, number>) {
  for (const [priceStr, qtyStr] of levels) {
    const price = Number(priceStr);
    const qty = Number(qtyStr);
    if (qty === 0) book.delete(price);
    else book.set(price, qty);
  }
}

/**
 * Binance USD-M futures diff-depth protocol: snapshot + buffered events,
 * bridged by `U <= lastUpdateId <= u` on the first event, then continuity
 * via `pu === previous event's u`. A break in either check means the local
 * book may be wrong — callers must re-snapshot (loadSnapshot again) rather
 * than keep applying events.
 */
export class DepthBook {
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private lastUpdateId = 0;
  private synced = false;

  loadSnapshot(snap: DepthSnapshotRaw): void {
    this.bids = new Map();
    this.asks = new Map();
    applyLevels(snap.bids, this.bids);
    applyLevels(snap.asks, this.asks);
    this.lastUpdateId = snap.lastUpdateId;
    this.synced = false;
  }

  applyEvent(evt: DepthEvent): ApplyResult {
    if (!this.synced) {
      if (evt.u < this.lastUpdateId) return "dropped";
      if (evt.U > this.lastUpdateId) return "gap";
      this.synced = true;
    } else if (evt.pu !== this.lastUpdateId) {
      return "gap";
    }

    applyLevels(evt.bids, this.bids);
    applyLevels(evt.asks, this.asks);
    this.lastUpdateId = evt.u;
    return "applied";
  }

  getState(): OrderBookState {
    const bids: DepthLevel[] = [...this.bids.entries()]
      .map(([price, qty]) => ({ price, qty }))
      .sort((a, b) => b.price - a.price);
    const asks: DepthLevel[] = [...this.asks.entries()]
      .map(([price, qty]) => ({ price, qty }))
      .sort((a, b) => a.price - b.price);
    return { bids, asks, lastUpdateId: this.lastUpdateId };
  }

  get isSynced(): boolean {
    return this.synced;
  }
}
