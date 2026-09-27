# Pine-TS Integration Guide

This guide runs a TypeScript Pine-style indicator over chart-sdk candle data and
renders the result with Lightweight Charts. It uses the published
`@nemesis-oss/pine-ts` package and chart-sdk's `executePineTsScript` bridge.

## Install

From the chart-sdk root:

```bash
npm install @nemesis-oss/pine-ts
```

The dependency is already included in this checkout at version `0.1.1`.

## Run an Indicator

Fetch candles through the broker adapter, then calculate a Pine SMA. Adapter
candle timestamps are Unix seconds; the bridge converts them to milliseconds
for PineRuntime and converts plot timestamps back to seconds for Lightweight
Charts.

```ts
import { ta } from "@nemesis-oss/pine-ts";
import { executePineTsScript } from "chart-sdk";

const candles = await adapter.fetchCandles("ETHUSDT", "15", 500);
const plots = await executePineTsScript({
  candles,
  symbol: "ETHUSDT",
  timeframe: "15",
  script: (context, plot) => {
    plot(ta.sma(context.close, 20).value, {
      title: "Pine SMA 20",
      color: "#00E5FF",
      lineWidth: 2,
    });
  },
});
```

## Render the Plot

Use the returned `CustomPlotDef` with the chart instance already used by
`TradingViewChart`:

```ts
const plot = plots[0];
if (plot) {
  const line = chart.addSeries(LineSeries, {
    title: plot.title,
    color: plot.color,
    lineWidth: plot.lineWidth,
    priceLineVisible: false,
    lastValueVisible: false,
  });
  line.setData(plot.data);
}
```

Each plotted value is emitted as `{ time, value }`. Non-finite values such as
Pine warm-up `na` are omitted, so the chart starts drawing only when the
indicator has a value. Multiple calls to `plot` in one script produce multiple
plot definitions.

## Timeframes and Symbols

Pass Pine timeframe strings: `"1"`, `"5"`, `"15"`, `"60"`, `"240"`,
`"1D"`, or `"1W"`. Convert chart labels such as `"1h"` to Pine's `"60"`
before calling the bridge. Supply `symbolInfo` when Pine code needs accurate
exchange metadata, especially for DhanHQ symbols:

```ts
symbolInfo: {
  ticker: "NIFTY",
  timezone: "Asia/Kolkata",
  type: "index",
}
```

## Current Scope

`executePineTsScript` is a historical/batch bridge: it treats supplied candles
as confirmed bars. Do not call it for every live tick; that would rebuild Pine
state and lose realtime rollback semantics. The current `IDataAdapter` candle
contract does not expose whether a candle is confirmed. A live integration
must preserve that state and keep one `PineRuntime` alive across history and
stream updates before indicators can use Pine's unconfirmed-bar rollback
correctly.

Pine-TS is a TypeScript runtime, not a Pine source compiler. This bridge accepts
a TypeScript callback; it does not execute arbitrary Pine text from the script
editor.

## Verify

```bash
npm test -- --run src/scripting/pineTsAdapter.test.ts
npm run typecheck
npm run build
```
