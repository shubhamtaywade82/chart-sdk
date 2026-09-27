import { DepthLevel, EngineTrade, WallLevel } from "./types";

export function computeCVD(trades: EngineTrade[]): number {
  return trades.reduce((sum, t) => sum + (t.isSell ? -t.qty : t.qty), 0);
}

export function computeWindowedCVD(trades: EngineTrade[], windowMs: number, now: number): number {
  return computeCVD(trades.filter((t) => now - t.time <= windowMs));
}

export function detectWalls(
  levels: DepthLevel[],
  side: "bid" | "ask",
  firstSeenAt: Map<number, number>,
  now: number,
  opts: { minQty: number; persistenceMs: number }
): WallLevel[] {
  return levels
    .filter((l) => l.qty >= opts.minQty)
    .map((l) => ({
      price: l.price,
      qty: l.qty,
      side,
      ageMs: now - (firstSeenAt.get(l.price) ?? now),
    }))
    .filter((w) => w.ageMs >= opts.persistenceMs);
}

export function computeImbalance(bids: DepthLevel[], asks: DepthLevel[], depthLevels: number): number {
  const bidSum = bids.slice(0, depthLevels).reduce((s, l) => s + l.qty, 0);
  const askSum = asks.slice(0, depthLevels).reduce((s, l) => s + l.qty, 0);
  const total = bidSum + askSum;
  return total > 0 ? bidSum / total : 0.5;
}

/** A bid wall is absorbed by taker sells hitting it; an ask wall by taker buys. */
export function detectAbsorption(
  wall: WallLevel,
  trades: EngineTrade[],
  opts: { absorptionMultiplier: number }
): boolean {
  const takerIsSell = wall.side === "bid";
  const opposingVolume = trades
    .filter((t) => t.price === wall.price && t.isSell === takerIsSell)
    .reduce((s, t) => s + t.qty, 0);
  return opposingVolume >= wall.qty * opts.absorptionMultiplier;
}
