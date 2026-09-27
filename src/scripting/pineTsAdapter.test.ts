import { ta } from "@nemesis-oss/pine-ts";
import { describe, expect, it } from "vitest";
import { executePineTsScript } from "./pineTsAdapter";

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
});