// Mathematical and Technical Analysis routines for Pine Script v6 and JS runtime

export const taSma = (source: number[], length: number): number[] => {
  const result: number[] = new Array(source.length).fill(NaN);
  if (length <= 0 || source.length < length) return result;

  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += source[i] || 0;
  }
  result[length - 1] = sum / length;

  for (let i = length; i < source.length; i++) {
    sum += (source[i] || 0) - (source[i - length] || 0);
    result[i] = sum / length;
  }
  return result;
};

export const taEma = (source: number[], length: number): number[] => {
  const result: number[] = new Array(source.length).fill(NaN);
  if (length <= 0 || source.length < length) return result;

  const k = 2 / (length + 1);
  let ema = source[0] || 0;
  result[0] = ema;

  for (let i = 1; i < source.length; i++) {
    const val = source[i] || 0;
    ema = val * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
};

export const taRsi = (source: number[], length = 14): number[] => {
  const result: number[] = new Array(source.length).fill(NaN);
  if (source.length <= length) return result;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= length; i++) {
    const change = (source[i] || 0) - (source[i - 1] || 0);
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / length;
  let avgLoss = losses / length;

  result[length] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = length + 1; i < source.length; i++) {
    const change = (source[i] || 0) - (source[i - 1] || 0);
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (length - 1) + gain) / length;
    avgLoss = (avgLoss * (length - 1) + loss) / length;

    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
};

export const taMacd = (
  source: number[],
  fast = 12,
  slow = 26,
  signal = 9
): { macd: number[]; signal: number[]; hist: number[] } => {
  const fastEma = taEma(source, fast);
  const slowEma = taEma(source, slow);
  const macdLine = source.map((_, i) =>
    isNaN(fastEma[i]) || isNaN(slowEma[i]) ? NaN : fastEma[i] - slowEma[i]
  );

  const firstValid = macdLine.findIndex((v) => !isNaN(v));
  const validMacd = firstValid >= 0 ? macdLine.slice(firstValid) : [];
  const validSignal = taEma(validMacd, signal);

  const signalLine: number[] = new Array(source.length).fill(NaN);
  if (firstValid >= 0) {
    for (let i = 0; i < validSignal.length; i++) {
      signalLine[firstValid + i] = validSignal[i];
    }
  }

  const hist = macdLine.map((m, i) =>
    isNaN(m) || isNaN(signalLine[i]) ? NaN : m - signalLine[i]
  );

  return { macd: macdLine, signal: signalLine, hist };
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

export const taHighest = (source: number[], length: number): number[] => {
  const result: number[] = new Array(source.length).fill(NaN);
  for (let i = length - 1; i < source.length; i++) {
    let max = -Infinity;
    for (let j = 0; j < length; j++) {
      const v = source[i - j] ?? -Infinity;
      if (v > max) max = v;
    }
    result[i] = max;
  }
  return result;
};

export const taLowest = (source: number[], length: number): number[] => {
  const result: number[] = new Array(source.length).fill(NaN);
  for (let i = length - 1; i < source.length; i++) {
    let min = Infinity;
    for (let j = 0; j < length; j++) {
      const v = source[i - j] ?? Infinity;
      if (v < min) min = v;
    }
    result[i] = min;
  }
  return result;
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
  const middle = taSma(source, length);
  const upper = new Array(source.length).fill(NaN);
  const lower = new Array(source.length).fill(NaN);

  for (let i = length - 1; i < source.length; i++) {
    const mean = middle[i];
    let sumSq = 0;
    for (let j = 0; j < length; j++) {
      const diff = (source[i - j] || 0) - mean;
      sumSq += diff * diff;
    }
    const stdev = Math.sqrt(sumSq / length);
    upper[i] = mean + mult * stdev;
    lower[i] = mean - mult * stdev;
  }

  return { middle, upper, lower };
};
