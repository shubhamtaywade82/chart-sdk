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
    session.processHistoricalBar(bar, () => series.at(0), i === lastIndex);
  });

  return [...series.history()];
};

export const taEmaPine = (source: number[], length: number): number[] =>
  runOnClose(source, (session) => ta.ema(session.sources.close, length));

export const taSmaPine = (source: number[], length: number): number[] =>
  runOnClose(source, (session) => ta.sma(session.sources.close, length));
