import { describe, it, expect } from "vitest";
import { computeCVD, detectWalls, computeImbalance, detectAbsorption } from "./derived";
import { EngineTrade, DepthLevel, WallLevel } from "./types";

function trade(price: number, qty: number, isSell: boolean): EngineTrade {
  return { id: 1, time: Date.now(), price, qty, isSell, usd: price * qty };
}

describe("computeCVD", () => {
  it("sums buys positive and sells negative", () => {
    const cvd = computeCVD([trade(100, 2, false), trade(100, 1, true), trade(100, 3, false)]);
    expect(cvd).toBe(2 - 1 + 3);
  });

  it("returns 0 for no trades", () => {
    expect(computeCVD([])).toBe(0);
  });
});

describe("detectWalls", () => {
  const levels: DepthLevel[] = [{ price: 100, qty: 50 }, { price: 99, qty: 2 }];

  it("excludes levels below minQty", () => {
    const firstSeen = new Map([[100, 0], [99, 0]]);
    const walls = detectWalls(levels, "bid", firstSeen, 10_000, { minQty: 10, persistenceMs: 0 });
    expect(walls).toEqual([{ price: 100, qty: 50, side: "bid", ageMs: 10_000 }]);
  });

  it("excludes levels that haven't persisted long enough", () => {
    const firstSeen = new Map([[100, 9_500]]);
    const walls = detectWalls(levels, "bid", firstSeen, 10_000, { minQty: 10, persistenceMs: 1_000 });
    expect(walls).toEqual([]);
  });

  it("includes a level right at the persistence boundary", () => {
    const firstSeen = new Map([[100, 9_000]]);
    const walls = detectWalls(levels, "bid", firstSeen, 10_000, { minQty: 10, persistenceMs: 1_000 });
    expect(walls).toEqual([{ price: 100, qty: 50, side: "bid", ageMs: 1_000 }]);
  });

  it("treats an unseen level as age 0", () => {
    const walls = detectWalls(levels, "ask", new Map(), 10_000, { minQty: 10, persistenceMs: 0 });
    expect(walls).toEqual([{ price: 100, qty: 50, side: "ask", ageMs: 0 }]);
  });
});

describe("computeImbalance", () => {
  it("returns the bid share of total top-N volume", () => {
    const bids: DepthLevel[] = [{ price: 100, qty: 30 }];
    const asks: DepthLevel[] = [{ price: 101, qty: 10 }];
    expect(computeImbalance(bids, asks, 5)).toBeCloseTo(0.75);
  });

  it("only considers the top N levels per side", () => {
    const bids: DepthLevel[] = [{ price: 100, qty: 10 }, { price: 99, qty: 100 }];
    const asks: DepthLevel[] = [{ price: 101, qty: 10 }];
    expect(computeImbalance(bids, asks, 1)).toBeCloseTo(0.5); // only the first bid level (10) counted
  });

  it("returns 0.5 for an empty book", () => {
    expect(computeImbalance([], [], 5)).toBe(0.5);
  });
});

describe("detectAbsorption", () => {
  const bidWall: WallLevel = { price: 100, qty: 50, side: "bid", ageMs: 5_000 };

  it("triggers when opposing (taker-sell) volume at the wall's price meets the multiplier", () => {
    const trades = [trade(100, 60, true), trade(100, 5, false)]; // 60 taker-sell volume at 100
    expect(detectAbsorption(bidWall, trades, { absorptionMultiplier: 1 })).toBe(true);
  });

  it("does not trigger below the multiplier threshold", () => {
    const trades = [trade(100, 10, true)];
    expect(detectAbsorption(bidWall, trades, { absorptionMultiplier: 1 })).toBe(false);
  });

  it("ignores trades on the same side as the wall (taker-buy doesn't absorb a bid wall)", () => {
    const trades = [trade(100, 1000, false)];
    expect(detectAbsorption(bidWall, trades, { absorptionMultiplier: 1 })).toBe(false);
  });

  it("ignores trades at a different price", () => {
    const trades = [trade(101, 1000, true)];
    expect(detectAbsorption(bidWall, trades, { absorptionMultiplier: 1 })).toBe(false);
  });
});
