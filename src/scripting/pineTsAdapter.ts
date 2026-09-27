import { PineRuntime } from "@nemesis-oss/pine-ts";
import type { PineContext, SymbolInfo, Bar, MarketDataProvider } from "@nemesis-oss/pine-ts";
import type { CandleData } from "./scriptSandbox";
import type { CustomPlotDef } from "./types";

export interface PineTsPlotOptions {
  readonly title?: string;
  readonly color?: string;
  readonly lineWidth?: number;
}

export type PineTsPlot = (value: number, options?: PineTsPlotOptions) => void;
export type PineTsScript = (context: PineContext, plot: PineTsPlot) => void;

export interface ExecutePineTsScriptOptions {
  readonly candles: readonly CandleData[];
  readonly symbol: string;
  readonly timeframe: string;
  readonly symbolInfo?: SymbolInfo;
  readonly script: PineTsScript;
}

export const executePineTsScript = async (
  options: ExecutePineTsScriptOptions,
): Promise<CustomPlotDef[]> => {
  const bars: readonly Bar[] = options.candles.map((candle) => ({
    time: Math.trunc(candle.time * 1000),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    isClosed: true,
    symbol: options.symbol,
    timeframe: options.timeframe,
  }));
  const symbolInfo = options.symbolInfo ?? {
    ticker: options.symbol,
    timezone: "UTC",
    type: "crypto",
  };
  const provider: MarketDataProvider = {
    getHistoricalBars: () => Promise.resolve(bars),
    streamBars: () => ({
      [Symbol.asyncIterator]: async function* () {
        await Promise.resolve();
      },
    }),
    getSymbolInfo: () => Promise.resolve(symbolInfo),
  };
  const plots: CustomPlotDef[] = [];
  const runtime = new PineRuntime({
    provider,
    symbol: options.symbol,
    timeframe: options.timeframe,
  });

  await runtime.run((context) => {
    let plotIndex = 0;
    const plot: PineTsPlot = (value, plotOptions = {}) => {
      const currentIndex = plotIndex;
      plotIndex += 1;
      let target = plots[currentIndex];
      if (target === undefined) {
        target = {
          id: `pine_ts_${currentIndex}`,
          title: plotOptions.title ?? `Plot ${currentIndex + 1}`,
          color: plotOptions.color ?? "#00E5FF",
          lineWidth: plotOptions.lineWidth ?? 1.5,
          style: "line",
          data: [],
        };
        plots.push(target);
      }
      if (Number.isFinite(value)) {
        target.data.push({ time: Math.trunc(context.bar.time / 1000), value });
      }
    };
    options.script(context, plot);
  }, bars);

  return plots;
};