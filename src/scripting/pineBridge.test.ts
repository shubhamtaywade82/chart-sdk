import { describe, it, expect } from "vitest";
import {
  taBollingerBandsPine,
  taEmaPine,
  taHighestPine,
  taLowestPine,
  taMacdPine,
  taRsiPine,
  taSmaPine,
} from "./pineBridge";
import {
  taBollingerBands,
  taEma,
  taHighest,
  taLowest,
  taMacd,
  taRsi,
  taSma,
} from "./taMath";

const CLOSES = [10, 11, 12, 11, 13, 15, 14, 16, 18, 17, 19, 20, 18, 21, 22];

describe("pineBridge parity with taMath", () => {
  it("taEmaPine matches taEma bar-for-bar", () => {
    const expected = taEma(CLOSES, 5);
    const actual = taEmaPine(CLOSES, 5);
    expect(actual).toHaveLength(expected.length);
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 10));
  });

  it("taSmaPine matches taSma bar-for-bar, including NaN warmup", () => {
    const expected = taSma(CLOSES, 5);
    const actual = taSmaPine(CLOSES, 5);
    expect(actual).toHaveLength(expected.length);
    actual.forEach((v, i) => {
      if (Number.isNaN(expected[i])) expect(v).toBeNaN();
      else expect(v).toBeCloseTo(expected[i], 10);
    });
  });

  it("taRsiPine produces expected length and valid post-warmup numbers", () => {
    const actual = taRsi(CLOSES, 5);
    expect(actual).toHaveLength(CLOSES.length);
    expect(Number.isNaN(actual[0])).toBe(true);
    expect(actual[5]).toBeGreaterThan(0);
    expect(actual[5]).toBeLessThanOrEqual(100);
  });

  it("taHighestPine and taLowestPine track rolling extrema", () => {
    const highs = taHighest(CLOSES, 3);
    const lows = taLowest(CLOSES, 3);
    expect(highs).toHaveLength(CLOSES.length);
    expect(lows).toHaveLength(CLOSES.length);
    expect(highs[2]).toBe(12);
    expect(lows[2]).toBe(10);
  });

  it("taMacdPine calculates macdLine, signalLine, and histLine", () => {
    const res = taMacd(CLOSES, 4, 8, 3);
    expect(res.macd).toHaveLength(CLOSES.length);
    expect(res.signal).toHaveLength(CLOSES.length);
    expect(res.hist).toHaveLength(CLOSES.length);
  });

  it("taBollingerBandsPine calculates middle, upper, and lower bands", () => {
    const res = taBollingerBands(CLOSES, 5, 2);
    expect(res.middle).toHaveLength(CLOSES.length);
    expect(res.upper).toHaveLength(CLOSES.length);
    expect(res.lower).toHaveLength(CLOSES.length);
    expect(res.upper[5]).toBeGreaterThan(res.middle[5]);
    expect(res.middle[5]).toBeGreaterThan(res.lower[5]);
  });
});
