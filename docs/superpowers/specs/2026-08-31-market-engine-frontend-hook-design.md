# Shared Frontend Market Engine Hook — Sub-project 2 of 4

## Problem

The new native Binance market engine (sub-project 1: diff-depth order book,
CVD, walls, imbalance, absorption, liquidations, funding/OI, broadcast over
`/ws/feed`) has no frontend consumer yet. Depth/trade/derived-signal data in
this codebase today still comes from two separate, duplicate, direct-to-
Binance pipelines:

1. `market3d/useMarketWebSocket.ts` — one combined WS connection per
   `Market2DView` instance, subscribing to `@kline_<tf>`, `@aggTrade`,
   `@depth20@100ms`, `@bookTicker`, `@ticker` directly against Binance's
   public WS. Depth is capped at the top 20 levels (partial-book stream);
   no CVD/walls/imbalance/absorption/liquidations exist here at all.
2. `BinanceAdapter.ts` — `subscribeOrderBook()` opens its own WS (tries
   `${host}/ws/binance/feed?symbol=...` first, which — via `vite.config.ts`'s
   `/ws/binance` → `/ws` rewrite — actually already reaches the new engine's
   `/ws/feed` and gets real data through the legacy `tick` compatibility
   message; falls back to Binance's public `@depth20@100ms` directly if that
   fails). Because it only parses the legacy `tick` shape, it gets top-20
   depth and nothing else — none of the new derived signals. Separately,
   `fetchPerpetualMetrics()` polls `fapi.binance.com/premiumIndex` +
   `/openInterest` directly via REST — duplicating exactly what the new
   engine's `SymbolEngine.pollFunding()` already computes and broadcasts as
   a `funding` message every 5s.

Neither pipeline can surface CVD, walls, imbalance, absorption, or
liquidations — the whole point of sub-project 1 — because neither was built
to consume the new engine's richer message contract.

## Goal

One shared hook, `useMarketEngine(symbol)`, that connects to `/ws/feed`,
speaks the new engine's real message contract (not the legacy compat
shape), and exposes book/trades/cvd/windowedCvd/walls/absorptions/
imbalance/liquidations/funding plus connection status
(`wsStatus`/`msgRate`/`pingMs`, matching what callers already expect from
`useMarketWebSocket` today). This is the shared consumer both sub-project 3
(Real-Time Terminal integration) and sub-project 4 (2D chart integration)
build on — its shape needs to be right since two future consumers depend on
it, even though this sub-project itself doesn't build either integration.

This sub-project also migrates `Market2DView.tsx` onto the new hook (proof
the hook actually works end-to-end for a real consumer) and retires the one
part of `BinanceAdapter.ts` that's safe to touch here: `subscribeOrderBook()`'s
dead Binance-direct fallback path (its primary path already routes through
the new backend and works — confirmed by reading the code, see Design §4).

## Non-goals

- **Candles stay exactly where they already work.** `BinanceAdapter`'s
  kline WS/REST (used by `TradingViewChart.tsx`, untouched) and
  `market3d/useMarketWebSocket.ts`'s kline handling (used by
  `Market2DView.tsx`) are not replaced. The new engine hardcodes one candle
  interval per symbol server-side (sub-project 1's own scope boundary) —
  making it interval-aware per-subscriber is real backend work, explicitly
  out of scope here. `useMarketWebSocket.ts` is *trimmed*, not deleted: its
  `@aggTrade`/`@depth20@100ms`/`@bookTicker`/`@ticker` handling and the
  `onTrade`/`onDepth`/`onBookTicker`/`onTicker24h` callback params are
  removed; `@kline_<tf>`/`onKline` stays, since `Market2DView` still needs
  it.
- **No shared/multiplexed WS connection registry.** One dedicated
  connection per hook instance, mirroring `useMarketWebSocket` today. The
  app never mounts two consumers of the same symbol simultaneously in one
  browser tab (views are conditionally rendered, one active at a time) — a
  connection-sharing singleton would solve a problem this codebase doesn't
  have. The backend already refcounts per-symbol subscriptions *across*
  tabs/clients; that's the multiplexing layer that matters.
- **Real-Time Terminal and 2D chart integration themselves** (consuming the
  hook to actually render heatmap/CVD/wall/liquidation visuals) are
  sub-projects 3 and 4, separate specs. This sub-project only proves the
  hook works by wiring `Market2DView`'s existing depth/trade/tape rendering
  onto it — no new visuals.
- **`subscribeOrderBook()`'s local-backend-proxy path is not deleted**,
  only its dead Binance-direct fallback branch. Other, unrelated
  `BinanceAdapter` methods (ticks, klines, order execution, positions) are
  untouched.
- **`fetchPerpetualMetrics()` is NOT retired here.** Its only caller,
  `TradingViewChart.tsx`, isn't migrated onto `useMarketEngine` until
  sub-project 3 — deleting it now would silently break the Real-Time
  Terminal's funding/OI readout before any replacement exists for it, the
  same class of mistake sub-project 1's final review caught (retiring a
  data path a live, unmigrated consumer still depends on). It stays
  duplicative-but-working until sub-project 3 actually swaps its caller.
- **`AdaptiveSupertrendWorkbench.tsx`** also calls `subscribeOrderBook()` —
  confirmed its usage only exercises the primary (already-backend-routed)
  path, so it's unaffected by dropping the dead fallback. Not otherwise
  touched by this sub-project.

## Design

### 1. `src/hooks/useMarketEngine.ts` (new)

First hook to live outside `market3d/`/`market2d/` — it's genuinely shared,
not DepthCube-specific.

```ts
export function useMarketEngine(symbol: string) {
  // returns:
  // { book: OrderBookState, trades: EngineTrade[], cvd: number, windowedCvd: number,
  //   walls: WallLevel[], absorptions: AbsorptionEvent[], imbalance: number,
  //   liquidations: LiquidationEvent[], funding: FundingInfo,
  //   wsStatus: "connecting" | "live" | "reconnecting" | "offline",
  //   msgRate: number, pingMs: number | null }
}
```

Types (`EngineTrade`, `OrderBookState`, `WallLevel`, `AbsorptionEvent`,
`LiquidationEvent`, `FundingInfo`, `EngineMessage`) are `import type`-ed
directly from `server/binance/engine/types.ts` — zero runtime cost (type-only
imports are fully erased by the bundler), and it keeps the wire contract
single-sourced instead of hand-duplicating a parallel frontend copy that can
drift from what the backend actually sends.

Internally: opens one `WebSocket` to `/ws/feed` (via the existing
`vite.config.ts` `/ws` proxy, same as `useMarketWebSocket` does today for
its own connection), sends `{type:"subscribe", symbol}` on open and again on
`symbol` change, applies incoming `EngineMessage`s to local state
(`snapshot` replaces everything at once; `candle`/`book`/`trade`/
`liquidation`/`funding` apply incrementally — mirroring exactly how
`SymbolEngine`'s own `flush()`/`emitUpdate()` producer side already shapes
these messages), reconnects with backoff on close/error (same pattern
`useMarketWebSocket` already uses), and tracks `msgRate` the same way
`useMarketWebSocket` does (a 1s message counter). `pingMs` measures latency
to *our own backend* now, not Binance — `useMarketWebSocket`'s
`pingBinanceTime()` pings `api.binance.com` directly, which is the wrong
target once the connection itself is to `/ws/feed`. Time a periodic
`fetch("/api/session-info")` instead (already mounted by sub-project 1's
legacy-router fix, cheap, always responds) — no new backend endpoint
needed.

Ignores incoming `candle` messages (the hook doesn't expose candles at all,
per the Non-goals scope) and the legacy `tick` message (that's for
not-yet-migrated consumers only).

### 2. `market3d/useMarketWebSocket.ts` — trim to klines-only

Remove: `onTrade`, `onDepth`, `onBookTicker`, `onTicker24h` params and their
handling in `routeMessage`/`startSim`. Remove `@aggTrade`, `@depth20@100ms`,
`@bookTicker`, `@ticker` from the subscribed stream list — keep only
`@kline_<interval>`. Keep: `onKline`, `wsStatus`/`msgRate`/`pingMs`,
reconnect/simulation-fallback logic (unchanged, just for a narrower stream
set).

### 3. `Market2DView.tsx` — consume both hooks

Replace the single `useMarketWebSocket` call's `onTrade`/`onDepth`/
`onBookTicker`/`onTicker24h` wiring with a `useMarketEngine(currentSymbol)`
call feeding `OrderBookLadder`/`TimeAndSalesPanel`/`CandleCanvas`'s heatmap
input. Keep the (now klines-only) `useMarketWebSocket` call for `onKline`.
Two hook calls, two WS connections (one to Binance for klines, one to our
backend for everything else) — this is the direct, expected consequence of
the Non-goals scope decision, not an oversight.

### 4. `BinanceAdapter.ts` — drop the one dead path

`subscribeOrderBook()` keeps its `IDataAdapter` callback-based signature
(reworking that interface is out of scope — `AdaptiveSupertrendWorkbench.tsx`
and the Coindcx/DhanHQ adapters all depend on its current shape) and keeps
talking to `/ws/binance/feed` (still routes to the new backend via
`vite.config.ts`'s proxy, still gets real data through the legacy `tick`
message). Only the dead `publicWsUrl` Binance-direct fallback and the
raw-array (`Array.isArray(msg.bids)`) parsing branch it exists for are
removed — confirmed safe because the primary path already succeeds against
the running backend (verified live in sub-project 1's testing), so the
fallback has nothing left to fall back *for*.

`fetchPerpetualMetrics()` is untouched (see Non-goals).

### 5. Testing

`useMarketEngine`'s message-application logic (how each `EngineMessage`
variant updates local state) is the one piece of real branching logic here
— worth a small set of unit tests using constructed fixture messages (no
live WS needed), similar in spirit to sub-project 1's `depthSync.test.ts`.
The connection/reconnect machinery itself is verified manually, live,
against the running backend — same as `SymbolEngine`'s WS handling was.
