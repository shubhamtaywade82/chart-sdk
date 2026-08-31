# Binance Market Engine (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native `chart-sdk/server/binance/` market-data engine — correct diff-depth order book, full trade/liquidation capture, funding/OI, and server-side derived signals (CVD, walls, imbalance, absorption) — broadcast over `/ws/feed`, retiring the shim to the standalone `binance-charts` repo.

**Architecture:** One `SymbolEngine` (Node `EventEmitter`) per actively-subscribed symbol, holding a `DepthBook` (diff-depth protocol) plus kline/trade/liquidation/funding state, computing derived signals via pure functions in `derived.ts`. `websocket-feed.service.ts` keeps the existing refcounted per-symbol subscribe/cleanup shape, creating/tearing down `SymbolEngine` instances and broadcasting both the new granular message types and a backward-compatible `tick` message (see Task 7 — required so the untouched frontend keeps working).

**Tech Stack:** Node.js (`tsx`), Express, `ws`, native `fetch`, Vitest (new dev dependency — this repo has no test runner yet).

**Spec:** `docs/superpowers/specs/2026-08-30-binance-market-engine-design.md`

## Global Constraints

- Binance USD-M **futures** endpoints only (`fapi.binance.com` REST, `fstream.binance.com` WS) — confirmed by the existing funding/OI header fields in the running app, which only exist on futures.
- No new runtime dependency beyond `ws`/`express`/`cors`/`dotenv` (already present) — no `binance-client-ts`, no HTTP client library (use global `fetch`).
- `depthSync.ts` and `derived.ts` must stay pure (no network/fs/timers) so they're unit-testable with fixtures.
- Backend listens on port `3002`, WebSocketServer at path `/ws/feed` — fixed by `vite.config.ts`'s dev proxy (`/ws` → `ws://localhost:3002`, `/api` → `http://localhost:3002`), not a free choice.
- `BinanceAdapter.ts`, `MarketDepthStream.tsx`, `TradingViewChart.tsx`, `market3d/useMarketWebSocket.ts` are **not modified** in this plan. The spec promises they "keep working exactly as they do today" — this means the new service must still emit the legacy `type: "tick"` message shape the frontend already parses (Task 7 covers this explicitly; the spec's prose didn't spell out the wire-format implication, this plan fills that gap).
- Two field-name deviations from the spec's literal wording, both because the spec's referenced frontend types can't be imported into a Node backend without side effects:
  - `market3d/types.ts` imports `three` (for chart-mesh types) — importing it from `server/` would pull the `three` package into the backend process. This plan defines standalone backend types in `engine/types.ts` instead, with **identical field names** (`t,o,h,l,c,v,bv` / `time,price,qty,isSell,usd` / etc.) so a later frontend hook can map 1:1 with no translation layer, per the spec's actual intent.
  - The spec's depth-sync pseudocode uses spot's `U == prevU + 1` continuity check. Binance's **futures** diff-depth protocol (which this plan targets, per the constraint above) instead provides an explicit `pu` field that must equal the previous event's `u`. Task 3 implements the futures-correct version.

---

## File Structure

```
server/binance/
  index.ts                    # rewritten: express+http+WebSocketServer bootstrap (was: shim to ../../../binance-charts/server/index)
  websocket-feed.service.ts   # rewritten: refcounted subscribe/broadcast (was: 1s REST poll + price-only @trade)
  engine/
    types.ts                  # shared interfaces (no logic)
    depthSync.ts               # DepthBook class: futures diff-depth protocol
    depthSync.test.ts
    derived.ts                  # computeCVD, detectWalls, computeImbalance, detectAbsorption
    derived.test.ts
    binanceRest.ts              # fetchKlines, fetchDepthSnapshot, fetchFundingAndOI
    SymbolEngine.ts              # per-symbol orchestration, EventEmitter
vitest.config.ts               # new
package.json                   # add "vitest" devDependency + "test" script
```

---

### Task 1: Test infrastructure (Vitest)

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `server/binance/engine/smoke.test.ts` (deleted at the end of this task — its only job is proving the runner works)

**Interfaces:** none (tooling only).

- [ ] **Step 1: Install Vitest**

Run: `npm install -D vitest`

- [ ] **Step 2: Add the test script**

In `package.json`, inside `"scripts"`, add:

```json
"test": "vitest run",
```

- [ ] **Step 3: Add `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write a throwaway smoke test**

`server/binance/engine/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest smoke test", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 6: Delete the smoke test**

```bash
rm server/binance/engine/smoke.test.ts
```

(Real tests start in Task 3. This step only proved the runner is wired correctly.)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest test runner"
```

---

### Task 2: Shared engine types

**Files:**
- Create: `server/binance/engine/types.ts`

**Interfaces:**
- Produces: `EngineCandle`, `EngineTrade`, `DepthLevel`, `OrderBookState`, `WallLevel`, `FundingInfo`, `LiquidationEvent`, `AbsorptionEvent`, `EngineMessage` — consumed by every task from here on.

- [ ] **Step 1: Write the file**

```ts
export interface EngineCandle {
  t: number; // open time, ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // base asset volume
  bv: number; // taker buy base asset volume
}

export interface EngineTrade {
  id: number;
  time: number;
  price: number;
  qty: number;
  isSell: boolean; // true = taker sold (matches Binance's `m` / buyer-is-maker flag)
  usd: number;
}

export interface DepthLevel {
  price: number;
  qty: number;
}

export interface OrderBookState {
  bids: DepthLevel[]; // sorted descending by price
  asks: DepthLevel[]; // sorted ascending by price
  lastUpdateId: number;
}

export interface WallLevel {
  price: number;
  qty: number;
  side: "bid" | "ask";
  ageMs: number;
}

export interface FundingInfo {
  fundingRate: number;
  openInterest: number;
  nextFundingTime: number;
}

export interface LiquidationEvent {
  price: number;
  qty: number;
  side: "buy" | "sell"; // side of the liquidation order itself
  time: number;
}

export interface AbsorptionEvent {
  price: number;
  side: "bid" | "ask"; // side of the wall being absorbed
  qty: number; // the wall's size at detection time
  detectedAt: number;
}

export type EngineMessage =
  | {
      type: "snapshot";
      symbol: string;
      candles: EngineCandle[];
      book: OrderBookState;
      trades: EngineTrade[];
      cvd: number;
      walls: WallLevel[];
      imbalance: number;
      absorptions: AbsorptionEvent[];
      funding: FundingInfo;
    }
  | { type: "candle"; symbol: string; candle: EngineCandle }
  | {
      type: "book";
      symbol: string;
      bids: DepthLevel[];
      asks: DepthLevel[];
      walls: WallLevel[];
      imbalance: number;
      absorptions: AbsorptionEvent[];
    }
  | { type: "trade"; symbol: string; trade: EngineTrade; cvd: number }
  | { type: "liquidation"; symbol: string; liq: LiquidationEvent }
  | { type: "funding"; symbol: string; funding: FundingInfo };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors (this file has no logic to break, but confirms it parses and `tsconfig.json`'s `include: ["src"]` doesn't need touching — `server/` is executed directly by `tsx`, not through this tsconfig; see Task 8 for how `tsx` handles it).

- [ ] **Step 3: Commit**

```bash
git add server/binance/engine/types.ts
git commit -m "feat(binance-engine): add shared engine types"
```

---

### Task 3: Diff-depth order book (`DepthBook`)

**Files:**
- Create: `server/binance/engine/depthSync.ts`
- Test: `server/binance/engine/depthSync.test.ts`

**Interfaces:**
- Consumes: `DepthLevel`, `OrderBookState` from `./types`.
- Produces: `DepthBook` class, `DepthEvent` interface, `DepthSnapshotRaw` interface — consumed by `SymbolEngine.ts` (Task 6).

```ts
interface DepthEvent { U: number; u: number; pu: number; bids: [string, string][]; asks: [string, string][]; }
interface DepthSnapshotRaw { lastUpdateId: number; bids: [string, string][]; asks: [string, string][]; }

class DepthBook {
  loadSnapshot(snap: DepthSnapshotRaw): void;
  applyEvent(evt: DepthEvent): "applied" | "dropped" | "gap";
  getState(): OrderBookState; // full book, sorted
  get isSynced(): boolean;
}
```

- [ ] **Step 1: Write the failing tests**

`server/binance/engine/depthSync.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DepthBook } from "./depthSync";

function snap(lastUpdateId: number, bids: [string, string][], asks: [string, string][]) {
  return { lastUpdateId, bids, asks };
}

function evt(U: number, u: number, pu: number, bids: [string, string][] = [], asks: [string, string][] = []) {
  return { U, u, pu, bids, asks };
}

describe("DepthBook", () => {
  it("is not synced before a snapshot is loaded", () => {
    const book = new DepthBook();
    expect(book.isSynced).toBe(false);
  });

  it("loads a snapshot into sorted bid/ask state", () => {
    const book = new DepthBook();
    book.loadSnapshot(snap(100, [["10.0", "1"], ["9.0", "2"]], [["11.0", "1"], ["12.0", "2"]]));
    const state = book.getState();
    expect(state.lastUpdateId).toBe(100);
    expect(state.bids).toEqual([{ price: 10, qty: 1 }, { price: 9, qty: 2 }]); // descending
    expect(state.asks).toEqual([{ price: 11, qty: 1 }, { price: 12, qty: 2 }]); // ascending
  });

  it("drops events fully older than the snapshot", () => {
    const book = new DepthBook();
    book.loadSnapshot(snap(100, [], []));
    const result = book.applyEvent(evt(90, 99, 89));
    expect(result).toBe("dropped");
    expect(book.isSynced).toBe(false);
  });

  it("bridges the first event when U <= lastUpdateId <= u, becomes synced", () => {
    const book = new DepthBook();
    book.loadSnapshot(snap(100, [["10.0", "1"]], []));
    const result = book.applyEvent(evt(95, 105, 94, [["10.0", "1.5"]], []));
    expect(result).toBe("applied");
    expect(book.isSynced).toBe(true);
    expect(book.getState().bids).toEqual([{ price: 10, qty: 1.5 }]);
    expect(book.getState().lastUpdateId).toBe(105);
  });

  it("reports a gap when the first event does not bridge the snapshot (U too high)", () => {
    const book = new DepthBook();
    book.loadSnapshot(snap(100, [], []));
    const result = book.applyEvent(evt(101, 110, 100));
    expect(result).toBe("gap");
    expect(book.isSynced).toBe(false);
  });

  it("applies continuous events (pu matches previous u)", () => {
    const book = new DepthBook();
    book.loadSnapshot(snap(100, [["10.0", "1"]], []));
    book.applyEvent(evt(95, 105, 94, [["10.0", "2"]], []));
    const result = book.applyEvent(evt(106, 108, 105, [["10.0", "3"]], []));
    expect(result).toBe("applied");
    expect(book.getState().bids).toEqual([{ price: 10, qty: 3 }]);
  });

  it("reports a gap when pu does not match the previous u", () => {
    const book = new DepthBook();
    book.loadSnapshot(snap(100, [["10.0", "1"]], []));
    book.applyEvent(evt(95, 105, 94));
    const result = book.applyEvent(evt(107, 110, 106)); // pu=106, but previous u was 105
    expect(result).toBe("gap");
  });

  it("removes a price level when qty is 0", () => {
    const book = new DepthBook();
    book.loadSnapshot(snap(100, [["10.0", "1"], ["9.0", "2"]], []));
    book.applyEvent(evt(95, 105, 94, [["9.0", "0"]], []));
    expect(book.getState().bids).toEqual([{ price: 10, qty: 1 }]);
  });

  it("inserts a new price level not present in the snapshot", () => {
    const book = new DepthBook();
    book.loadSnapshot(snap(100, [["10.0", "1"]], []));
    book.applyEvent(evt(95, 105, 94, [["10.5", "3"]], []));
    expect(book.getState().bids).toEqual([{ price: 10.5, qty: 3 }, { price: 10, qty: 1 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- depthSync`
Expected: FAIL — `Cannot find module './depthSync'`.

- [ ] **Step 3: Implement `DepthBook`**

`server/binance/engine/depthSync.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- depthSync`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add server/binance/engine/depthSync.ts server/binance/engine/depthSync.test.ts
git commit -m "feat(binance-engine): add futures diff-depth order book sync"
```

---

### Task 4: Derived signal calculators

**Files:**
- Create: `server/binance/engine/derived.ts`
- Test: `server/binance/engine/derived.test.ts`

**Interfaces:**
- Consumes: `EngineTrade`, `DepthLevel`, `WallLevel` from `./types`.
- Produces: `computeCVD`, `detectWalls`, `computeImbalance`, `detectAbsorption` — consumed by `SymbolEngine.ts` (Task 6).

```ts
function computeCVD(trades: EngineTrade[]): number;
function detectWalls(levels: DepthLevel[], side: "bid" | "ask", firstSeenAt: Map<number, number>, now: number, opts: { minQty: number; persistenceMs: number }): WallLevel[];
function computeImbalance(bids: DepthLevel[], asks: DepthLevel[], depthLevels: number): number;
function detectAbsorption(wall: WallLevel, trades: EngineTrade[], opts: { absorptionMultiplier: number }): boolean;
```

- [ ] **Step 1: Write the failing tests**

`server/binance/engine/derived.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- derived`
Expected: FAIL — `Cannot find module './derived'`.

- [ ] **Step 3: Implement**

`server/binance/engine/derived.ts`:

```ts
import { DepthLevel, EngineTrade, WallLevel } from "./types";

export function computeCVD(trades: EngineTrade[]): number {
  return trades.reduce((sum, t) => sum + (t.isSell ? -t.qty : t.qty), 0);
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- derived`
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add server/binance/engine/derived.ts server/binance/engine/derived.test.ts
git commit -m "feat(binance-engine): add CVD/wall/imbalance/absorption calculators"
```

---

### Task 5: Binance REST wrappers

**Files:**
- Create: `server/binance/engine/binanceRest.ts`

**Interfaces:**
- Consumes: `EngineCandle`, `FundingInfo` from `./types`; `DepthSnapshotRaw` from `./depthSync`.
- Produces: `fetchKlines`, `fetchDepthSnapshot`, `fetchFundingAndOI` — consumed by `SymbolEngine.ts` (Task 6).

No automated test for this file — it's thin network I/O with no branching logic beyond field mapping (the spec assigns network-dependent modules to manual verification, same as `SymbolEngine`/`websocket-feed.service.ts` in Task 9). Verified manually in Task 9's end-to-end check.

- [ ] **Step 1: Write the file**

```ts
import { EngineCandle, FundingInfo } from "./types";
import { DepthSnapshotRaw } from "./depthSync";

const REST_BASE = "https://fapi.binance.com";

export async function fetchKlines(symbol: string, interval: string, limit: number): Promise<EngineCandle[]> {
  const url = `${REST_BASE}/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchKlines: HTTP ${res.status}`);
  const raw = (await res.json()) as (string | number)[][];
  return raw.map((k) => ({
    t: Number(k[0]),
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
    bv: Number(k[9] || 0),
  }));
}

export async function fetchDepthSnapshot(symbol: string, limit: number): Promise<DepthSnapshotRaw> {
  const url = `${REST_BASE}/fapi/v1/depth?symbol=${symbol.toUpperCase()}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchDepthSnapshot: HTTP ${res.status}`);
  const raw = (await res.json()) as { lastUpdateId: number; bids: [string, string][]; asks: [string, string][] };
  return { lastUpdateId: raw.lastUpdateId, bids: raw.bids, asks: raw.asks };
}

export async function fetchFundingAndOI(symbol: string): Promise<FundingInfo> {
  const sym = symbol.toUpperCase();
  const [premiumRes, oiRes] = await Promise.all([
    fetch(`${REST_BASE}/fapi/v1/premiumIndex?symbol=${sym}`),
    fetch(`${REST_BASE}/fapi/v1/openInterest?symbol=${sym}`),
  ]);
  if (!premiumRes.ok) throw new Error(`fetchFundingAndOI: premiumIndex HTTP ${premiumRes.status}`);
  if (!oiRes.ok) throw new Error(`fetchFundingAndOI: openInterest HTTP ${oiRes.status}`);
  const premium = (await premiumRes.json()) as { lastFundingRate: string; nextFundingTime: number };
  const oi = (await oiRes.json()) as { openInterest: string };
  return {
    fundingRate: Number(premium.lastFundingRate),
    openInterest: Number(oi.openInterest),
    nextFundingTime: Number(premium.nextFundingTime),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit server/binance/engine/binanceRest.ts --module esnext --moduleResolution bundler --target es2020 --skipLibCheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/binance/engine/binanceRest.ts
git commit -m "feat(binance-engine): add futures REST wrappers (klines, depth snapshot, funding/OI)"
```

---

### Task 6: `SymbolEngine` orchestration

**Files:**
- Create: `server/binance/engine/SymbolEngine.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–5 (`./types`, `./depthSync`, `./derived`, `./binanceRest`).
- Produces:
  ```ts
  class SymbolEngine extends EventEmitter {
    constructor(symbol: string, interval: string);
    start(): Promise<void>;
    stop(): void;
    getSnapshotMessage(): Extract<EngineMessage, { type: "snapshot" }>;
    // emits 'update' with payload: Exclude<EngineMessage, { type: "snapshot" }>
  }
  ```
  Consumed by `websocket-feed.service.ts` (Task 7).

No automated test — this is the class that owns live WebSocket/timer state (per the spec's Testing section, verified manually in Task 9). Its dependencies (`DepthBook`, `computeCVD`, etc.) are already covered by Tasks 3–4's unit tests; this task is integration wiring.

- [ ] **Step 1: Write the file**

```ts
import { EventEmitter } from "events";
import WebSocket from "ws";
import { DepthBook, DepthEvent } from "./depthSync";
import { computeCVD, computeImbalance, detectAbsorption, detectWalls } from "./derived";
import { fetchDepthSnapshot, fetchFundingAndOI, fetchKlines } from "./binanceRest";
import { AbsorptionEvent, EngineCandle, EngineMessage, EngineTrade, FundingInfo, LiquidationEvent, WallLevel } from "./types";

const WS_BASE = "wss://fstream.binance.com";
const KLINE_SEED_COUNT = 500;
const DEPTH_SNAPSHOT_LIMIT = 1000;
const DEPTH_BROADCAST_LEVELS = 50;
const TRADE_BUFFER_SIZE = 2000;
const LIQUIDATION_BUFFER_SIZE = 200;
const FUNDING_POLL_MS = 5_000;
const BOOK_TRADE_FLUSH_MS = 250;
const WALL_MIN_QTY = 5;
const WALL_PERSISTENCE_MS = 2_000;
const IMBALANCE_DEPTH_LEVELS = 20;
const ABSORPTION_MULTIPLIER = 1.5;
const ABSORPTION_WINDOW_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

type UpdateMessage = Exclude<EngineMessage, { type: "snapshot" }>;

export class SymbolEngine extends EventEmitter {
  private readonly symbol: string;
  private readonly interval: string;
  private candles: EngineCandle[] = [];
  private readonly book = new DepthBook();
  private trades: EngineTrade[] = [];
  private liquidations: LiquidationEvent[] = [];
  private funding: FundingInfo = { fundingRate: 0, openInterest: 0, nextFundingTime: 0 };

  private bidFirstSeen = new Map<number, number>();
  private askFirstSeen = new Map<number, number>();
  private prevBidPrices = new Set<number>();
  private prevAskPrices = new Set<number>();

  private depthEventBuffer: DepthEvent[] = [];
  private depthSnapshotLoaded = false;

  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private fundingTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  private pendingBookUpdate = false;
  private pendingTrades: EngineTrade[] = [];

  constructor(symbol: string, interval: string) {
    super();
    this.symbol = symbol.toLowerCase();
    this.interval = interval;
  }

  async start(): Promise<void> {
    this.destroyed = false;
    await this.seedKlines();
    await this.resyncDepth();
    this.connectStream();
    this.fundingTimer = setInterval(() => this.pollFunding(), FUNDING_POLL_MS);
    this.pollFunding();
    this.flushTimer = setInterval(() => this.flush(), BOOK_TRADE_FLUSH_MS);
  }

  stop(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.fundingTimer) clearInterval(this.fundingTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  getSnapshotMessage(): Extract<EngineMessage, { type: "snapshot" }> {
    const state = this.book.getState();
    const { walls, absorptions } = this.computeCurrentSignals();
    return {
      type: "snapshot",
      symbol: this.symbol,
      candles: this.candles,
      book: {
        bids: state.bids.slice(0, DEPTH_BROADCAST_LEVELS),
        asks: state.asks.slice(0, DEPTH_BROADCAST_LEVELS),
        lastUpdateId: state.lastUpdateId,
      },
      trades: this.trades.slice(0, 50),
      cvd: computeCVD(this.trades),
      walls,
      absorptions,
      imbalance: computeImbalance(state.bids, state.asks, IMBALANCE_DEPTH_LEVELS),
      funding: this.funding,
    };
  }

  private emitUpdate(msg: UpdateMessage) {
    this.emit("update", msg);
  }

  private async seedKlines(): Promise<void> {
    this.candles = await fetchKlines(this.symbol, this.interval, KLINE_SEED_COUNT);
  }

  private async resyncDepth(): Promise<void> {
    this.depthSnapshotLoaded = false;
    const snap = await fetchDepthSnapshot(this.symbol, DEPTH_SNAPSHOT_LIMIT);
    this.book.loadSnapshot(snap);
    this.depthSnapshotLoaded = true;
    this.prevBidPrices = new Set(snap.bids.map(([p]) => Number(p)));
    this.prevAskPrices = new Set(snap.asks.map(([p]) => Number(p)));
    const now = Date.now();
    this.bidFirstSeen = new Map([...this.prevBidPrices].map((p) => [p, now]));
    this.askFirstSeen = new Map([...this.prevAskPrices].map((p) => [p, now]));

    for (const evt of this.depthEventBuffer) this.applyDepthEvent(evt);
    this.depthEventBuffer = [];
  }

  private connectStream(): void {
    if (this.destroyed) return;
    const streams = [
      `${this.symbol}@kline_${this.interval}`,
      `${this.symbol}@aggTrade`,
      `${this.symbol}@depth@100ms`,
      `${this.symbol}@forceOrder`,
    ].join("/");
    const ws = new WebSocket(`${WS_BASE}/stream?streams=${streams}`);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempts = 0;
    });
    ws.on("message", (data) => this.handleMessage(data.toString()));
    ws.on("error", () => this.scheduleReconnect());
    ws.on("close", () => this.scheduleReconnect());
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.destroyed) return;
      await this.resyncDepth(); // reconnects always re-snapshot, per spec's resilience section
      this.connectStream();
    }, delay);
  }

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const stream: string = msg.stream || "";
    const d = msg.data;
    if (!d) return;

    if (stream.endsWith(`@kline_${this.interval}`)) this.handleKline(d);
    else if (stream.endsWith("@aggTrade")) this.handleTrade(d);
    else if (stream.endsWith("@depth@100ms")) this.handleDepthEvent(d);
    else if (stream.endsWith("@forceOrder")) this.handleLiquidation(d);
  }

  private handleKline(d: any): void {
    const k = d.k;
    if (!k) return;
    const candle: EngineCandle = {
      t: k.t,
      o: Number(k.o),
      h: Number(k.h),
      l: Number(k.l),
      c: Number(k.c),
      v: Number(k.v),
      bv: Number(k.V || 0),
    };
    const last = this.candles[this.candles.length - 1];
    if (last && last.t === candle.t) this.candles[this.candles.length - 1] = candle;
    else {
      this.candles.push(candle);
      if (this.candles.length > KLINE_SEED_COUNT) this.candles.shift();
    }
    this.emitUpdate({ type: "candle", symbol: this.symbol, candle });
  }

  private handleTrade(d: any): void {
    const trade: EngineTrade = {
      id: d.a,
      time: d.T,
      price: Number(d.p),
      qty: Number(d.q),
      isSell: Boolean(d.m),
      usd: Number(d.p) * Number(d.q),
    };
    this.trades.unshift(trade);
    if (this.trades.length > TRADE_BUFFER_SIZE) this.trades.length = TRADE_BUFFER_SIZE;
    this.pendingTrades.push(trade);
  }

  private handleDepthEvent(d: any): void {
    const evt: DepthEvent = { U: d.U, u: d.u, pu: d.pu, bids: d.b, asks: d.a };
    if (!this.depthSnapshotLoaded) {
      this.depthEventBuffer.push(evt);
      return;
    }
    this.applyDepthEvent(evt);
  }

  private applyDepthEvent(evt: DepthEvent): void {
    const result = this.book.applyEvent(evt);
    if (result === "gap") {
      this.resyncDepth();
      return;
    }
    if (result !== "applied") return;

    const now = Date.now();
    const state = this.book.getState();
    this.trackLevelAges(state.bids.map((l) => l.price), this.prevBidPrices, this.bidFirstSeen, now);
    this.trackLevelAges(state.asks.map((l) => l.price), this.prevAskPrices, this.askFirstSeen, now);
    this.pendingBookUpdate = true;
  }

  private trackLevelAges(
    currentPrices: number[],
    prevSet: Set<number>,
    firstSeen: Map<number, number>,
    now: number
  ): void {
    const currentSet = new Set(currentPrices);
    for (const price of currentSet) {
      if (!prevSet.has(price)) firstSeen.set(price, now);
    }
    for (const price of prevSet) {
      if (!currentSet.has(price)) firstSeen.delete(price);
    }
    prevSet.clear();
    for (const price of currentSet) prevSet.add(price);
  }

  private handleLiquidation(d: any): void {
    const o = d.o;
    if (!o) return;
    const liq: LiquidationEvent = {
      price: Number(o.p),
      qty: Number(o.q),
      side: o.S === "SELL" ? "sell" : "buy",
      time: o.T,
    };
    this.liquidations.unshift(liq);
    if (this.liquidations.length > LIQUIDATION_BUFFER_SIZE) this.liquidations.length = LIQUIDATION_BUFFER_SIZE;
    this.emitUpdate({ type: "liquidation", symbol: this.symbol, liq });
  }

  private async pollFunding(): Promise<void> {
    try {
      this.funding = await fetchFundingAndOI(this.symbol);
      this.emitUpdate({ type: "funding", symbol: this.symbol, funding: this.funding });
    } catch {
      // keep last-known value; retried on the next interval
    }
  }

  /** Walls, plus which of those walls show absorption right now — computed together since absorption is evaluated per-wall. */
  private computeCurrentSignals(): { walls: WallLevel[]; absorptions: AbsorptionEvent[] } {
    const state = this.book.getState();
    const now = Date.now();
    const wallOpts = { minQty: WALL_MIN_QTY, persistenceMs: WALL_PERSISTENCE_MS };
    const walls = [
      ...detectWalls(state.bids, "bid", this.bidFirstSeen, now, wallOpts),
      ...detectWalls(state.asks, "ask", this.askFirstSeen, now, wallOpts),
    ];

    const recentTrades = this.trades.filter((t) => now - t.time <= ABSORPTION_WINDOW_MS);
    const absorptions: AbsorptionEvent[] = walls
      .filter((wall) => detectAbsorption(wall, recentTrades, { absorptionMultiplier: ABSORPTION_MULTIPLIER }))
      .map((wall) => ({ price: wall.price, side: wall.side, qty: wall.qty, detectedAt: now }));

    return { walls, absorptions };
  }

  private flush(): void {
    if (this.pendingBookUpdate) {
      this.pendingBookUpdate = false;
      const state = this.book.getState();
      const { walls, absorptions } = this.computeCurrentSignals();
      this.emitUpdate({
        type: "book",
        symbol: this.symbol,
        bids: state.bids.slice(0, DEPTH_BROADCAST_LEVELS),
        asks: state.asks.slice(0, DEPTH_BROADCAST_LEVELS),
        walls,
        absorptions,
        imbalance: computeImbalance(state.bids, state.asks, IMBALANCE_DEPTH_LEVELS),
      });
    }
    if (this.pendingTrades.length > 0) {
      const cvd = computeCVD(this.trades);
      for (const trade of this.pendingTrades) {
        this.emitUpdate({ type: "trade", symbol: this.symbol, trade, cvd });
      }
      this.pendingTrades = [];
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit server/binance/engine/SymbolEngine.ts --module esnext --moduleResolution bundler --target es2020 --skipLibCheck --lib es2020,dom`
Expected: no errors. (`--lib dom` is needed here only because global `fetch`'s ambient types come from the DOM lib in this TS version; Node itself provides the runtime.)

- [ ] **Step 3: Manual verification script**

Create a throwaway script (not committed) to sanity-check the engine against live Binance data:

```bash
cat > /tmp/verify-symbol-engine.mjs << 'EOF'
import { SymbolEngine } from "./server/binance/engine/SymbolEngine.ts";
const engine = new SymbolEngine("btcusdt", "1m");
engine.on("update", (msg) => console.log(msg.type, JSON.stringify(msg).slice(0, 200)));
await engine.start();
console.log("--- snapshot ---");
console.log(JSON.stringify(engine.getSnapshotMessage()).slice(0, 500));
setTimeout(() => { engine.stop(); process.exit(0); }, 20_000);
EOF
npx tsx /tmp/verify-symbol-engine.mjs
```

Expected: a snapshot log line with populated `candles`/`book`/`funding`, then a stream of `candle`/`trade`/`book` (and, if one happens to occur, `liquidation`) update lines over the 20s window. Confirms the WS connects, depth syncs (no repeated `gap`→resync loop in the console — add a temporary `console.log` in `applyDepthEvent`'s `gap` branch if you need to confirm this directly, then remove it), and funding data populates.

```bash
rm /tmp/verify-symbol-engine.mjs
```

- [ ] **Step 4: Commit**

```bash
git add server/binance/engine/SymbolEngine.ts
git commit -m "feat(binance-engine): add SymbolEngine orchestration (WS streams, reconnect, derived signals)"
```

---

### Task 7: WebSocket transport (`websocket-feed.service.ts`)

**Files:**
- Modify: `server/binance/websocket-feed.service.ts` (full rewrite — the existing file is the old 1s-poll implementation being replaced)

**Interfaces:**
- Consumes: `SymbolEngine` (Task 6), `EngineMessage` (Task 2).
- Produces: `WebSocketFeedService.attach(wss: WebSocketServer): void` — consumed by `index.ts` (Task 8). Identical signature to the file being replaced, so the bootstrap call site doesn't change.

- [ ] **Step 1: Write the file**

```ts
import { WebSocketServer, WebSocket } from "ws";
import { SymbolEngine } from "./engine/SymbolEngine";
import { EngineMessage } from "./engine/types";

const DEFAULT_INTERVAL = "1m";

interface SymbolEntry {
  engine: SymbolEngine;
  subscriberCount: number;
  clients: Set<WebSocket>;
}

export class WebSocketFeedService {
  private static engines = new Map<string, SymbolEntry>();

  public static attach(wss: WebSocketServer): void {
    wss.on("connection", (ws: WebSocket) => {
      console.log("🔌 client connected");
      let currentSymbol: string | null = null;

      const unsubscribeCurrent = () => {
        if (!currentSymbol) return;
        const entry = this.engines.get(currentSymbol);
        if (entry) {
          entry.clients.delete(ws);
          entry.subscriberCount--;
          if (entry.subscriberCount <= 0) {
            entry.engine.stop();
            this.engines.delete(currentSymbol);
            console.log(`🧹 stopped engine for idle symbol: ${currentSymbol}`);
          }
        }
        currentSymbol = null;
      };

      const subscribeTo = async (symbolRaw: string) => {
        unsubscribeCurrent();
        const symbol = symbolRaw.toLowerCase();
        currentSymbol = symbol;

        let entry = this.engines.get(symbol);
        if (!entry) {
          const engine = new SymbolEngine(symbol, DEFAULT_INTERVAL);
          entry = { engine, subscriberCount: 0, clients: new Set() };
          this.engines.set(symbol, entry);
          engine.on("update", (msg: Exclude<EngineMessage, { type: "snapshot" }>) => {
            this.broadcast(entry!, msg);
          });
          await engine.start();
        }
        entry.subscriberCount++;
        entry.clients.add(ws);

        if (ws.readyState === WebSocket.OPEN) {
          const snapshot = entry.engine.getSnapshotMessage();
          ws.send(JSON.stringify(snapshot));
          ws.send(JSON.stringify(this.toLegacyTick(snapshot)));
        }
      };

      ws.on("message", (raw) => {
        try {
          const parsed = JSON.parse(raw.toString());
          if (parsed.type === "subscribe" && parsed.symbol) {
            subscribeTo(parsed.symbol).catch((err) => console.error("subscribe failed:", err));
          }
        } catch {}
      });

      ws.on("close", () => {
        unsubscribeCurrent();
        console.log("🔌 client disconnected");
      });
    });
  }

  private static broadcast(entry: SymbolEntry, msg: Exclude<EngineMessage, { type: "snapshot" }>): void {
    const payload = JSON.stringify(msg);
    const legacyPayload = msg.type === "candle" || msg.type === "book"
      ? JSON.stringify(this.toLegacyTickFromUpdate(entry, msg))
      : null;
    for (const client of entry.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(payload);
      if (legacyPayload) client.send(legacyPayload);
    }
  }

  /** Backward-compat shape for the not-yet-migrated frontend (BinanceAdapter/App.tsx `tick` handler). */
  private static toLegacyTick(snapshot: Extract<EngineMessage, { type: "snapshot" }>) {
    const last = snapshot.candles[snapshot.candles.length - 1];
    const prev = snapshot.candles[snapshot.candles.length - 2];
    const ltp = last?.c ?? 0;
    const prevClose = prev?.c ?? ltp;
    return {
      type: "tick",
      symbol: snapshot.symbol,
      securityId: snapshot.symbol.toUpperCase(),
      ltp,
      prevClose,
      change: Number((ltp - prevClose).toFixed(2)),
      pChange: prevClose > 0 ? Number((((ltp - prevClose) / prevClose) * 100).toFixed(2)) : 0,
      volume: last?.v ?? 0,
      bids: snapshot.book.bids.map((l) => ({ price: l.price, quantity: l.qty, orders: 1 })),
      asks: snapshot.book.asks.map((l) => ({ price: l.price, quantity: l.qty, orders: 1 })),
      timestamp: new Date().toISOString(),
    };
  }

  private static toLegacyTickFromUpdate(
    entry: SymbolEntry,
    msg: Extract<EngineMessage, { type: "candle" } | { type: "book" }>
  ) {
    return this.toLegacyTick(entry.engine.getSnapshotMessage());
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit server/binance/websocket-feed.service.ts --module esnext --moduleResolution bundler --target es2020 --skipLibCheck --lib es2020,dom`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/binance/websocket-feed.service.ts
git commit -m "feat(binance-engine): rewrite websocket-feed.service on SymbolEngine, keep legacy tick compat"
```

---

### Task 8: Backend bootstrap — retire the shim

**Files:**
- Modify: `server/binance/index.ts` (replacing the entire shim contents)

**Interfaces:**
- Consumes: `WebSocketFeedService.attach` (Task 7).
- Produces: the running server itself — this is the entry point `npm run backend:binance` / `dev:binance` execute.

- [ ] **Step 1: Write the file**

```ts
import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import { WebSocketFeedService } from "./websocket-feed.service";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/feed" });
WebSocketFeedService.attach(wss);

const PORT = Number(process.env.BINANCE_PORT || process.env.PORT || 3002);
server.listen(PORT, () => {
  console.log(`🚀 Binance market engine backend running at http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Boot it**

Run: `npx tsx server/binance/index.ts`
Expected console output: `🚀 Binance market engine backend running at http://localhost:3002`, no crash.
Stop with Ctrl+C.

- [ ] **Step 3: Verify `/ws/feed` end-to-end with a real client**

With the server still running (`npx tsx server/binance/index.ts &`), from another terminal:

```bash
cat > /tmp/verify-ws-feed.mjs << 'EOF'
import WebSocket from "ws";
const ws = new WebSocket("ws://localhost:3002/ws/feed");
ws.on("open", () => ws.send(JSON.stringify({ type: "subscribe", symbol: "btcusdt" })));
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  console.log(msg.type);
});
setTimeout(() => process.exit(0), 15_000);
EOF
npx tsx /tmp/verify-ws-feed.mjs
rm /tmp/verify-ws-feed.mjs
```

Expected: a `snapshot` line, a `tick` line (legacy compat), then a mix of `candle`/`trade`/`book`/`tick`/`funding` lines over the 15s window. This is the same wire format `App.tsx`'s existing `/ws/feed` consumer and the new engine's future consumers (sub-projects 2–4) will both read — confirms both compatibility paths work.

Stop the background server: `kill %1` (or find/kill the `tsx server/binance/index.ts` process).

- [ ] **Step 4: Run the full app to confirm nothing else broke**

```bash
npm run dev:binance
```

Open `http://localhost:5200` in a browser, confirm: header price ticks, `MarketDepthStream` panel (Controls → the depth panel toggle, or wherever it's shown in the current layout) shows bid/ask rows updating, `TradingViewChart` candles render — all exactly as before this plan started, since these consumers still read the same `/ws/feed` legacy `tick` shape plus their own separate `BinanceAdapter`/`useMarketWebSocket` pipelines untouched by this plan.

Stop the dev servers (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add server/binance/index.ts
git commit -m "feat(binance-engine): retire binance-charts shim, boot native engine backend"
```

---

### Task 9: Final cleanup and full verification

**Files:** none created — verification and a final check for stray references.

- [ ] **Step 1: Confirm nothing else references the old shim path**

Run: `grep -rn "binance-charts" server/ src/ package.json 2>/dev/null`
Expected: no output (the only reference was the deleted shim in `server/binance/index.ts`).

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all `depthSync.test.ts` and `derived.test.ts` tests pass (22 total from Tasks 3–4), no other failures.

- [ ] **Step 3: Typecheck the whole project**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors (this covers `src/`; `server/` files were typechecked individually per-task in Tasks 2–8 since they're outside `tsconfig.json`'s `include`).

- [ ] **Step 4: Full manual smoke test**

Run: `npm run dev:crypto` (starts both `server/binance` and `server/coindcx` plus the Vite frontend). Confirm in the browser:
- Real-Time Terminal (default tab): candles + header ticker + depth panel all update live, same as Task 8 Step 4.
- 2D DepthCube Market tab and 3D DepthCube Market tab: still work — they use their own independent `market3d/useMarketWebSocket.ts` pipeline, untouched by this plan, so this just confirms no accidental cross-break (e.g., a port conflict).
- CoinDCX app (`npm run dev:coindcx` in a separate check, or trust Step 1's grep + the fact `server/coindcx` wasn't touched) unaffected.

Stop the dev servers.

- [ ] **Step 5: Final commit (if Step 1's grep or manual testing required any fixups)**

```bash
git add -A
git commit -m "chore(binance-engine): final cleanup pass"
```

(Skip this commit if there was nothing to fix — don't create an empty commit.)

---

## Self-Review

**Spec coverage:**
- §1 File Structure → Task 1 (File Structure section above).
- §2 `depthSync.ts` diff-depth protocol → Task 3 (implemented as the futures `pu`-based variant, per Global Constraints' documented deviation from the spec's spot-flavored pseudocode).
- §3 `derived.ts` → Task 4, all four functions.
- §4 `SymbolEngine.ts` → Task 6.
- §5 `websocket-feed.service.ts` transport/throttling → Task 7 (throttling implemented inside `SymbolEngine.flush()` rather than the service, a small internal placement choice — the spec didn't mandate which layer owns it, and keeping it in the engine means the service stays a pure broadcaster).
- §6 Message contract → Task 2's `EngineMessage`, matches the spec's shape with the `types.ts`-location deviation documented in Global Constraints.
- §7 Resilience → Task 6 (`scheduleReconnect`, `resyncDepth` on both gap-detection and reconnect, funding poll failure handling).
- §8 Testing → Tasks 3–4 (pure-function unit tests), Tasks 6–8 (manual verification scripts).
- §9 Cutover → Task 8 (shim replaced), Task 9 Step 1 (grep confirms no stray references) — plus the legacy `tick` compat (Task 7) that the spec's prose implied but didn't spell out at the wire-format level, documented as a plan-level refinement in Global Constraints.

**Placeholder scan:** no TBD/TODO; every step has real, complete code; no "similar to Task N" references.

**Type consistency:** `EngineCandle`/`EngineTrade`/`DepthLevel`/`OrderBookState`/`WallLevel`/`FundingInfo`/`LiquidationEvent`/`AbsorptionEvent`/`EngineMessage` are defined once in Task 2 and used with identical names/shapes in every later task. `DepthBook`/`DepthEvent`/`DepthSnapshotRaw` (Task 3) are used identically in Task 5 (`fetchDepthSnapshot` returns `DepthSnapshotRaw`) and Task 6 (`SymbolEngine` constructs `DepthEvent` from raw WS payloads). `computeCVD`/`detectWalls`/`computeImbalance`/`detectAbsorption` (Task 4) signatures match their call sites in Task 6 exactly (including the `side` parameter added to `detectWalls`, and `detectAbsorption` called once per current wall inside `computeCurrentSignals()` — verified against Task 4's own tests, which pass it explicitly).
