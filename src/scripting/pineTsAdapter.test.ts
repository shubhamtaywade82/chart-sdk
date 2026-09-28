import { ta } from "@nemesis-oss/pine-ts";
import { describe, expect, it } from "vitest";
import { executePineTsScript, executePineTsScriptFull } from "./pineTsAdapter";

describe("executePineTsScript", () => {
  it("maps chart candles to Pine bars and returns chart-ready indicator points", async () => {
    const plots = await executePineTsScript({
      candles: [10, 12, 14].map((close, index) => ({
        time: index + 1,
        open: close,
        high: close + 1,
        low: close - 1,
        close,
        volume: 5,
      })),
      symbol: "ETHUSDT",
      timeframe: "1",
      script: (context, plot) => {
        plot(ta.sma(context.close, 2).value, {
          title: "Pine SMA 2",
          color: "#00E5FF",
        });
      },
    });

    expect(plots).toEqual([
      {
        id: "pine_ts_0",
        title: "Pine SMA 2",
        color: "#00E5FF",
        lineWidth: 1.5,
        style: "line",
        data: [
          { time: 2, value: 11 },
          { time: 3, value: 13 },
        ],
      },
    ]);
  });

  it("preserves supplied symbol metadata in the Pine context", async () => {
    let ticker: string | undefined;

    await executePineTsScript({
      candles: [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
      symbol: "IDX_I:13",
      timeframe: "15",
      symbolInfo: { ticker: "NIFTY", timezone: "Asia/Kolkata", type: "index" },
      script: (context) => {
        ticker = context.syminfo.ticker;
      },
    });

    expect(ticker).toBe("NIFTY");
  });

  it("executes strategy logic and returns backtest metrics", async () => {
    const candles = [10, 12, 14, 11, 9].map((close, i) => ({
      time: i + 1,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 10,
    }));

    const result = await executePineTsScriptFull({
      candles,
      symbol: "BTCUSDT",
      timeframe: "1",
      script: (ctx, plot, helpers) => {
        plot(ctx.close.value, { title: "Close" });
        if (ctx.bar_index.value === 1) helpers?.strategy.entry("Long", "LONG");
        if (ctx.bar_index.value === 3) helpers?.strategy.close("Long");
      },
    });

    expect(result.success).toBe(true);
    expect(result.type).toBe("strategy");
    expect(result.trades).toBeDefined();
    expect(result.trades?.length).toBe(1);
    expect(result.stats).toBeDefined();
  });

  it("compiles and runs string script with shapes and helpers", async () => {
    const candles = [10, 15, 20].map((close, i) => ({
      time: i + 1,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 10,
    }));

    const scriptCode = `
      const { plot, plotshape, hline } = helpers;
      plot(ctx.close.value, { title: "Price" });
      hline(15, { title: "Mid" });
      if (ctx.close.value >= 15) {
        plotshape(true, { text: "HIGH" });
      }
    `;

    const result = await executePineTsScriptFull({
      candles,
      symbol: "ETHUSDT",
      timeframe: "5",
      script: scriptCode,
    });

    expect(result.success).toBe(true);
    expect(result.plots[0].data.length).toBe(3);
    expect(result.hlines.length).toBe(1);
    expect(result.shapes.length).toBe(2);
  });
});