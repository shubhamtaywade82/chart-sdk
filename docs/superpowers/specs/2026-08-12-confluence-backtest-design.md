# SMC/ICT Confluence Backtest Page

## Problem

`INDICATORS.md` catalogs SMC/ICT-style indicators (Order Blocks, FVG, BOS/CHoCH,
Liquidity Sweeps, Judas Swing, Silver Bullet/Kill Zones, OTE, Premium/Discount,
Supply/Demand, Trendline Liquidity, candle patterns) for crypto trading. Almost
all of them are already implemented in `smcEngine.ts` / `ictEngine.ts` and
rendered on-chart via `TradingViewChart.tsx`. `setupScanner.ts`'s `scanSetups()`
already fuses all of them into one LONG/SHORT/NO_TRADE signal with an
entry/stop/target recommendation — this is the de facto "SMC Confluence
Strategy" from the doc.

What's missing: none of it is backtestable. `FuturesBacktestWorkbench.tsx`
only backtests `AdaptiveSupertrend`.

## Goal

A separate page, one per broker app (binance/dhanhq/coindcx), that walks
historical candles bar-by-bar through `scanSetups()`, simulates trades against
its recommended stop/target, and reports the same kind of metrics
(win rate, profit factor, drawdown, equity curve, trade log) as the existing
futures backtest workbench.

## Non-goals

- Per-indicator isolated backtesting (FVG-only, OB-only, etc.) — `scanSetups`
  has no per-indicator entry/exit logic today; building that per indicator is
  a much larger, separate effort.
- Changing `scanSetups`' live-chart behavior — the only change to it is an
  additive, backward-compatible parameter.

## Design

### 1. `setupScanner.ts` — inject backtest clock

`scanSetups()` currently does `const now = Math.floor(Date.now() / 1000)`
internally, which is used for kill-zone/session recency checks
(`kzTiming`, `voteFromSweep`). For backtesting, "now" must be the historical
bar's timestamp, not wall-clock time.

```ts
export function scanSetups(input: SetupScanInput, asOf?: number): SetupSignal {
  const now = asOf ?? Math.floor(Date.now() / 1000);
  ...
}
```

Default preserves all existing call sites (`TradingViewChart.tsx`) unchanged.

### 2. `src/utils/confluenceBacktestEngine.ts` (new)

Walk-forward simulator:

- For each bar `i` (after a warmup window, e.g. 200 bars), take a rolling
  slice of the preceding N candles (matches the `latestNCandles(1000)`
  pattern already used in `TradingViewChart.tsx`), run the smcEngine/ictEngine
  detectors on that slice, assemble a `SetupScanInput`, call
  `scanSetups(input, candles[i].time)`.
- If no position is open and `direction !== "NO_TRADE"`, open a trade at
  `recommendedEntry` (market entry = bar close, stop/target from the
  recommendation).
- While a position is open, check each subsequent bar's high/low against
  stop and target; if both are touched within the same bar, stop is assumed
  hit first (conservative, matches standard backtest convention).
- Returns a summary shaped like `AdaptiveSupertrend`'s `BacktestSummary`/
  `BacktestTrade` (entryTime, exitTime, type, entryPrice, exitPrice, pnlPct,
  exitReason, stopPrice, targetPrice) so the UI layer can reuse the same
  leverage/margin mapping logic already in `FuturesBacktestWorkbench.tsx`.
- Recomputing detectors every bar over a full history is the naive approach;
  given typical backtest windows (≤2000 bars) and rolling-window detector
  cost, this stays within acceptable browser compute. No incremental/
  streaming optimization in v1.

### 3. `src/components/research/ConfluenceBacktestWorkbench.tsx` (new)

Same UI shell as `FuturesBacktestWorkbench.tsx` (interval/leverage/TP
controls, metrics cards, equity curve, trade log table, CSV export), swapping
the engine call from `AdaptiveSupertrend.runBacktest` to
`confluenceBacktestEngine`.

### 4. Wire into apps

Add one new tab per app (`binance`, `dhanhq`, `coindcx`):

- id: `"confluence_backtest"`
- label: `"SMC/ICT Confluence Backtest"`
- icon: reuse an existing lucide icon already imported in each App.tsx
  (e.g. `Layers` or `Activity`)
- renders `<ConfluenceBacktestWorkbench symbol={selectedSymbol} adapter={adapterInstance} />`

Mirrors the existing `"backtest"` tab wiring exactly.

## Testing

- Manual: run each app (`npm run dev:binance` etc.), open the new tab, run
  backtest on a live symbol, confirm trades/metrics render and CSV export
  works.
- `npm run typecheck` after changes.
