// Mathematical and Technical Analysis routines for Pine Script v6 and JS runtime
import {
  taBollingerBandsPine,
  taEmaPine,
  taHighestPine,
  taLowestPine,
  taMacdPine,
  taRsiPine,
  taSmaPine,
} from "./pineBridge";

export const taSma = (source: number[], length: number): number[] => {
  if (length <= 0 || source.length < length) return new Array(source.length).fill(NaN);
  return taSmaPine(source, length);
};

export const taEma = (source: number[], length: number): number[] => {
  if (length <= 0 || source.length < length) return new Array(source.length).fill(NaN);
  return taEmaPine(source, length);
};

export const taRsi = (source: number[], length = 14): number[] => {
  if (length <= 0 || source.length <= length) return new Array(source.length).fill(NaN);
  return taRsiPine(source, length);
};

export const taHighest = (source: number[], length: number): number[] => {
  if (length <= 0 || source.length < length) return new Array(source.length).fill(NaN);
  return taHighestPine(source, length);
};

export const taLowest = (source: number[], length: number): number[] => {
  if (length <= 0 || source.length < length) return new Array(source.length).fill(NaN);
  return taLowestPine(source, length);
};

export const taMacd = (
  source: number[],
  fast = 12,
  slow = 26,
  signal = 9
): { macd: number[]; signal: number[]; hist: number[] } => {
  if (source.length === 0) return { macd: [], signal: [], hist: [] };
  return taMacdPine(source, fast, slow, signal);
};

export const taTrueRange = (candles: { high: number; low: number; close: number }[]): number[] => {
  const tr: number[] = new Array(candles.length).fill(0);
  if (candles.length === 0) return tr;
  tr[0] = candles[0].high - candles[0].low;

  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hpc = Math.abs(candles[i].high - candles[i - 1].close);
    const lpc = Math.abs(candles[i].low - candles[i - 1].close);
    tr[i] = Math.max(hl, hpc, lpc);
  }
  return tr;
};

export const taAtr = (candles: { high: number; low: number; close: number }[], length = 14): number[] => {
  const tr = taTrueRange(candles);
  return taEma(tr, length);
};

export const taStoch = (
  candles: { high: number; low: number; close: number }[],
  periodK = 14,
  periodD = 3,
  smoothK = 3
): { k: number[]; d: number[] } => {
  const rawK: number[] = new Array(candles.length).fill(NaN);

  for (let i = periodK - 1; i < candles.length; i++) {
    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    for (let j = 0; j < periodK; j++) {
      const c = candles[i - j];
      if (c.high > highestHigh) highestHigh = c.high;
      if (c.low < lowestLow) lowestLow = c.low;
    }
    const denom = highestHigh - lowestLow;
    rawK[i] = denom === 0 ? 50 : ((candles[i].close - lowestLow) / denom) * 100;
  }

  const k = taSma(rawK, smoothK);
  const d = taSma(k, periodD);
  return { k, d };
};


export const taCrossover = (a: number[], b: number[]): boolean[] => {
  const result = new Array(a.length).fill(false);
  for (let i = 1; i < a.length; i++) {
    if (!isNaN(a[i]) && !isNaN(b[i]) && !isNaN(a[i - 1]) && !isNaN(b[i - 1])) {
      result[i] = a[i] > b[i] && a[i - 1] <= b[i - 1];
    }
  }
  return result;
};

export const taCrossunder = (a: number[], b: number[]): boolean[] => {
  const result = new Array(a.length).fill(false);
  for (let i = 1; i < a.length; i++) {
    if (!isNaN(a[i]) && !isNaN(b[i]) && !isNaN(a[i - 1]) && !isNaN(b[i - 1])) {
      result[i] = a[i] < b[i] && a[i - 1] >= b[i - 1];
    }
  }
  return result;
};

export const taBollingerBands = (
  source: number[],
  length = 20,
  mult = 2
): { middle: number[]; upper: number[]; lower: number[] } => {
  if (length <= 0 || source.length < length) {
    const empty = new Array(source.length).fill(NaN);
    return { middle: empty, upper: empty, lower: empty };
  }
  return taBollingerBandsPine(source, length, mult);
};
