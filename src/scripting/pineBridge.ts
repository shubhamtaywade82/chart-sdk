// Bridges chart-sdk's array-based indicator calls into pine-ts's session-driven
// Series model. pine-ts computes incrementally per bar (not a full-array
// rescan), so we replay the whole close series through one PineSession and
// read back the committed history — same output contract as taMath.ts.
import { PineSession, ta, type Bar, type FloatSeries } from "@nemesis-oss/pine-ts";

const runOnClose = (source: number[], build: (session: PineSession) => FloatSeries): number[] => {
  const session = new PineSession();
  const series = build(session);
  const lastIndex = source.length - 1;

  source.forEach((close, i) => {
    const bar: Bar = { time: i, open: close, high: close, low: close, close, volume: 0 };
    const isLast = i === lastIndex;
    session.processHistoricalBar(bar, () => series.at(0), {
      isLast,
      isLastConfirmedHistory: isLast,
    });
  });

  return [...series.history()];
};

export const taEmaPine = (source: number[], length: number): number[] =>
  runOnClose(source, (session) => ta.ema(session.sources.close, length));

export const taSmaPine = (source: number[], length: number): number[] =>
  runOnClose(source, (session) => ta.sma(session.sources.close, length));

export const taRsiPine = (source: number[], length = 14): number[] =>
  runOnClose(source, (session) => ta.rsi(session.sources.close, length));

export const taHighestPine = (source: number[], length: number): number[] =>
  runOnClose(source, (session) => ta.highest(session.sources.close, length));

export const taLowestPine = (source: number[], length: number): number[] =>
  runOnClose(source, (session) => ta.lowest(session.sources.close, length));

export const taMacdPine = (
  source: number[],
  fast = 12,
  slow = 26,
  signal = 9
): { macd: number[]; signal: number[]; hist: number[] } => {
  const session = new PineSession();
  const macd = ta.macd(session.sources.close, fast, slow, signal);
  const lastIndex = source.length - 1;

  source.forEach((close, i) => {
    const bar: Bar = { time: i, open: close, high: close, low: close, close, volume: 0 };
    const isLast = i === lastIndex;
    session.processHistoricalBar(
      bar,
      () => {
        macd.macdLine.at(0);
        macd.signalLine.at(0);
        macd.histLine.at(0);
      },
      { isLast, isLastConfirmedHistory: isLast }
    );
  });

  return {
    macd: [...macd.macdLine.history()],
    signal: [...macd.signalLine.history()],
    hist: [...macd.histLine.history()],
  };
};

export const taBollingerBandsPine = (
  source: number[],
  length = 20,
  mult = 2
): { middle: number[]; upper: number[]; lower: number[] } => {
  const session = new PineSession();
  const bb = ta.bb(session.sources.close, length, mult);
  const lastIndex = source.length - 1;

  source.forEach((close, i) => {
    const bar: Bar = { time: i, open: close, high: close, low: close, close, volume: 0 };
    const isLast = i === lastIndex;
    session.processHistoricalBar(
      bar,
      () => {
        bb.middle.at(0);
        bb.upper.at(0);
        bb.lower.at(0);
      },
      { isLast, isLastConfirmedHistory: isLast }
    );
  });

  return {
    middle: [...bb.middle.history()],
    upper: [...bb.upper.history()],
    lower: [...bb.lower.history()],
  };
};
