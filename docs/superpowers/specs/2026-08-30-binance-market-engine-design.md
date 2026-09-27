# Binance Market Engine (Backend) — Sub-project 1 of 4

## Problem

Market data for Binance is currently split across **three independent, duplicate
pipelines**:

1. `BinanceAdapter.ts` — direct browser→Binance WS for `@ticker`/`@kline`
   (feeds `TradingViewChart.tsx`), plus a separate `@depth20@100ms` WS and a
   REST poll for futures open interest.
2. `market3d/useMarketWebSocket.ts` — a second, fully independent direct
   browser→Binance WS connection (`@kline`, `@aggTrade`, `@depth20@100ms`,
   `@bookTicker`, `@ticker`), used only by the 3D/2D DepthCube views.
3. `/ws/feed` — a backend WebSocket whose server code
   (`binance-charts/server/services/websocket-feed.service.ts`) lives in a
   **separate standalone repo** (`binance-charts`, own git remote), reached
   from `chart-sdk/server/binance/index.ts` via a 6-line relative-path shim
   (`import("../../../binance-charts/server/index")`). This is a leftover
   from an incomplete migration — chart-sdk's frontend was extracted from
   `binance-charts` at some point, but the backend never was. It feeds the
   header ticker price and the `MarketDepthStream` panel.

Pipeline 3 is also the weakest: order-book depth is a **1-second REST poll of
the top 20 levels** (not even a WebSocket depth stream), trades come from raw
`@trade` with only the price extracted (quantity and taker side are
discarded — no CVD is possible from this), and there is no kline, funding,
open-interest, or liquidation data in it at all.

None of the three pipelines compute anything beyond what's needed to paint
raw OHLCV/book rows — no cumulative volume delta, liquidity-wall detection,
imbalance, absorption/spoofing signals, or liquidation feed exists anywhere
in this codebase today.

## Goal

Replace all three pipelines with **one backend market-data engine, native to
chart-sdk**, that:

- Maintains a correct, unlimited-depth local order book per symbol via
  Binance's official diff-depth protocol (not the partial-book/REST-poll
  shortcuts currently in use).
- Captures full `@aggTrade` data (price, qty, taker side) and `@forceOrder`
  liquidations.
- Polls funding rate / open interest.
- Computes derived signals **once, server-side** — CVD, liquidity walls,
  bid/ask imbalance, absorption/spoofing candidates — instead of every
  browser tab recomputing the same math.
- Broadcasts all of the above over one `/ws/feed`-style WebSocket to any
  number of browser clients, reusing one upstream Binance connection per
  symbol (reference-counted, same idle-teardown behavior the current
  `websocket-feed.service.ts` already has).

This sub-project delivers the **backend only**. It does not change what any
chart renders — `TradingViewChart.tsx`, `Market2DView`, `BinanceAdapter`, and
the old `binance-charts` repo are all left running exactly as they are today.
Wiring the frontend onto this engine is sub-projects 2–4 (their own specs,
later):

2. Shared frontend hook (`useMarketEngine`) replacing `useMarketWebSocket`
   and the depth/trade parts of `BinanceAdapter`.
3. Real-Time Terminal integration (`lightweight-charts` primitives: heatmap,
   wall/imbalance gauge, CVD pane, liquidation markers).
4. 2D DepthCube chart integration (same signals as new `canvasRenderer.ts`
   layers).

## Non-goals

- Touching CoinDCX or DhanHQ backends/adapters — Binance only (per user
  decision; those exchanges have different data shapes and their own
  already-native chart-sdk backends).
- Any frontend change. No chart, hook, or component is touched in this
  sub-project.
- Retiring or archiving the standalone `binance-charts` repo itself — only
  its role as chart-sdk's Binance backend is being replaced. What happens to
  that repo afterward is a separate decision.
- A generic multi-exchange engine interface/abstraction — YAGNI until a
  second exchange actually needs this same treatment.
- Historical replay/backtesting use of this engine — it's live-only. The
  existing `ConfluenceBacktestWorkbench`/`FuturesBacktestWorkbench` are
  unrelated and untouched.

## Design

### 1. Location: `chart-sdk/server/binance/`

`chart-sdk/server/binance/index.ts` currently re-exports the old repo's
server via a relative-path `import()`. That shim is deleted. In its place:

```
server/binance/
  index.ts              # express + http + WebSocketServer bootstrap (mirrors server/coindcx/index.ts's shape)
  engine/
    SymbolEngine.ts      # one instance per subscribed symbol
    depthSync.ts         # pure: Binance diff-depth protocol implementation
    derived.ts           # pure: CVD, walls, imbalance, absorption
    binanceRest.ts        # thin fetch() wrappers: klines, depth snapshot, funding/OI
  websocket-feed.service.ts   # refcounted per-symbol subscribe/broadcast (rewrite of the old service, same shape)
```

No new npm dependency. `binance-client-ts` (the old repo's Binance SDK
dependency) is dropped — the engine talks to Binance's public REST and WS
endpoints directly with `fetch`/`ws`, the same way `market3d/useMarketWebSocket.ts`
already does successfully from the browser. `express`, `ws`, `cors`, `dotenv`
are already chart-sdk dependencies (used by `server/coindcx/index.ts`).

### 2. `depthSync.ts` — diff-depth protocol

Pure module, no I/O — takes an event/snapshot sequence in, returns book
state out, so it's unit-testable with fixture data (no live network needed):

1. On (re)connect: start buffering every `@depth@100ms` event for the symbol
   immediately.
2. Fetch `GET /api/v3/depth?symbol=...&limit=1000`, record its
   `lastUpdateId`, load bids/asks into sorted arrays (bids descending, asks
   ascending).
3. Drop buffered events where `u <= lastUpdateId`.
4. The first applied event must satisfy `U <= lastUpdateId + 1 <= u` — if
   not, the snapshot is stale relative to the buffered stream; re-fetch and
   retry.
5. Apply subsequent deltas with a continuity check: each event's `U` must
   equal the previous event's `u + 1`. A gap triggers an automatic resync
   (jump back to step 2) — never silently serves a stale/incorrect book.
6. Per delta: `qty > 0` → insert/update via binary search on the sorted
   array; `qty == 0` → remove that price level.

### 3. `derived.ts` — pure computed signals

- `computeCVD(trades)` — running sum of `trade.isSell ? -qty : +qty` over the
  trade window (`isSell` mirrors Binance's `m`/taker-side flag, matching the
  field `TradeItem` already uses in `market3d/types.ts`); exposed as both a
  running total and a windowed delta.
- `detectWalls(book, { minQty, persistenceMs })` — price levels holding
  ≥ `minQty` for at least `persistenceMs` (requires the engine to track
  level age, not just current snapshot — `SymbolEngine` keeps a
  `Map<price, firstSeenAt>` per side, pruned on level removal).
- `computeImbalance(book, depthLevels)` — `sum(bidQty) / (sum(bidQty) + sum(askQty))`
  over the top N levels.
- `detectAbsorption(walls, trades)` — heuristic: a wall that has absorbed
  ≥ `k`× its own size in opposing-side trade volume without the price moving
  through it. Flags a candidate event; does not claim certainty (naive
  heuristic — ceiling noted, not a promise of accuracy).

All four are plain functions: data in, data out, no shared mutable state —
straightforward to unit test against constructed fixtures.

### 4. `SymbolEngine.ts` — per-symbol orchestration

One instance per actively-subscribed symbol (e.g. `btcusdt`), created lazily
on first subscriber and torn down when the last one disconnects — same
reference-counting lifecycle `websocket-feed.service.ts` already implements
today, just pointed at real upstream connections instead of the 1s poller:

- Kline cache: REST-seeded (last 500), kept live via `@kline_<interval>` WS.
- Order book: via `depthSync.ts`.
- Trade ring buffer: capped array (last ~2000 `@aggTrade` prints), fed into
  `computeCVD`.
- Funding rate / open interest: REST poll, default every 5s (matches the
  cadence `MarketDataService.syncRealBinanceFuturesPrices()` already used).
- Liquidations: `@forceOrder` WS, capped ring buffer.
- Extends Node's built-in `EventEmitter` (stdlib — not a new dependency);
  emits `'update'` with a typed payload whenever any of the above changes.
  `derived.ts` functions are invoked on relevant updates (book change →
  recompute walls/imbalance; trade → recompute CVD) — cheap enough at this
  data volume to run inline, no separate scheduler needed.

### 5. `websocket-feed.service.ts` — transport

Same shape as today: `wss.on('connection', ...)`, refcounted `subscribeTo`/
`unsubscribeCurrent`, idle-symbol cleanup. Per connected client:

- On subscribe: send one `snapshot` message with the `SymbolEngine`'s full
  current state.
- On every engine `'update'`: broadcast the changed slice as one of `candle`
  / `book` / `trade` / `liquidation` / `funding`.
- Book/trade broadcasts are throttled to the client at ~250ms (the engine
  itself stays accurate at Binance's native 100ms cadence internally —
  throttling only applies to what's sent over the wire, so book state is
  never stale by more than one throttle window).

### 6. Message contract (frozen now, consumed later by sub-projects 2–4)

Field shapes reuse `Candle3D` / `TradeItem` / `DepthData` from
`src/components/market3d/types.ts` where they already match, so no
translation layer is needed when the frontend hook (sub-project 2) is built:

```ts
type EngineMessage =
  | { type: "snapshot"; symbol: string; candles: Candle3D[]; book: DepthData;
      trades: TradeItem[]; cvd: number; walls: WallLevel[]; imbalance: number;
      funding: FundingInfo }
  | { type: "candle"; symbol: string; candle: Candle3D }
  | { type: "book"; symbol: string; bids: [string, string][]; asks: [string, string][];
      walls: WallLevel[]; imbalance: number }
  | { type: "trade"; symbol: string; trade: TradeItem; cvd: number }
  | { type: "liquidation"; symbol: string; price: number; qty: number; side: "buy" | "sell"; time: number }
  | { type: "funding"; symbol: string; fundingRate: number; openInterest: number };

interface WallLevel { price: number; qty: number; side: "bid" | "ask"; ageMs: number; }
interface FundingInfo { fundingRate: number; openInterest: number; nextFundingTime: number; }
```

### 7. Resilience

- Upstream Binance WS drop (kline/aggTrade/forceOrder/depth) → reconnect
  with exponential backoff; depth reconnect always re-snapshots (step 2 of
  `depthSync.ts`).
- Depth continuity gap detected → automatic resync, no manual intervention,
  no client-visible error (briefly stale, never wrong).
- REST failures (funding/OI poll) → log and keep the last-known value;
  retried on the next interval; never throws out of the poll loop.
- Last browser client for a symbol disconnects → refcount hits 0 → all of
  that symbol's upstream Binance connections are closed and its
  `SymbolEngine` is discarded. Idle symbols cost nothing, same as today.

### 8. Testing

- `depthSync.ts`: unit tests with constructed event/snapshot fixtures —
  correct book after a clean sequence, correct resync after an injected gap,
  correct handling of the "first event validity" edge case.
- `derived.ts`: unit tests with constructed book/trade fixtures — CVD sign
  and magnitude, wall detection at the persistence boundary, imbalance
  ratio, absorption trigger/non-trigger cases.
- `SymbolEngine.ts` / `websocket-feed.service.ts`: no live-network unit
  tests — verified manually against live Binance data (connect a WS client,
  confirm snapshot + incremental messages match what Binance's own
  streams/REST report), the same way the 2D chart was checked earlier in
  this project.

### 9. Cutover

`server/binance/index.ts`'s shim import is replaced with the new engine's
bootstrap. `package.json` scripts (`dev:binance`, `backend:binance`, etc.)
are unchanged — they already just run `tsx server/binance/index.ts`. Nothing
in the old `binance-charts` repo is modified; chart-sdk simply stops
importing it.

`BinanceAdapter.ts`, `MarketDepthStream.tsx`, `TradingViewChart.tsx`, and
`market3d/useMarketWebSocket.ts` are **not** touched here — they keep working
exactly as they do today, on their existing pipelines, until sub-projects
2–4 migrate them onto this engine one at a time.
