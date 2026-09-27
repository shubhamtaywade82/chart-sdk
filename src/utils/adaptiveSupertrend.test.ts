import { describe, it, expect } from "vitest";
import { AdaptiveSupertrend } from "./adaptiveSupertrend";
import type { Candle } from "../adapters/IDataAdapter";

function flatCandles(count: number, price = 100): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: i,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1,
  }));
}

describe("AdaptiveSupertrend cluster warm-up fallback", () => {
  it("uses fallbackMult, not the ensemble's minimum factor, while every member's perf is still zero", () => {
    const fallbackMult = 4.2;
    const engine = new AdaptiveSupertrend(10, fallbackMult, 85, 150, 25, 1.0, 6.0);
    // On the first bar every ensemble member's perf is 0, so the "Best" cluster is empty
    // and the fallback path is exercised.
    const series = engine.computeFullSeries(flatCandles(1));
    expect(series[0].targetFactor).toBe(fallbackMult);
  });

  it("different presets' fallbackMult actually diverges during warm-up", () => {
    const low = new AdaptiveSupertrend(10, 1.5, 85, 150, 25, 1.0, 6.0);
    const high = new AdaptiveSupertrend(10, 5.5, 85, 150, 25, 1.0, 6.0);
    const lowSeries = low.computeFullSeries(flatCandles(1));
    const highSeries = high.computeFullSeries(flatCandles(1));
    expect(lowSeries[0].targetFactor).toBe(1.5);
    expect(highSeries[0].targetFactor).toBe(5.5);
  });
});
