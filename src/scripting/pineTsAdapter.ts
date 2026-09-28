import { PineRuntime, ta, math, community } from "@nemesis-oss/pine-ts";
import type { PineContext, SymbolInfo, Bar, MarketDataProvider } from "@nemesis-oss/pine-ts";
import { runBacktest } from "./backtestEngine";
import type { CandleData } from "./scriptSandbox";
import type {
  CustomHLineDef,
  CustomPlotDef,
  CustomShapeDef,
  ScriptExecutionResult,
  ScriptType,
} from "./types";

export interface PineTsPlotOptions {
  readonly title?: string;
  readonly color?: string;
  readonly lineWidth?: number;
  readonly style?: "line" | "histogram";
}

export interface PineTsShapeOptions {
  readonly style?: "triangleup" | "triangledown" | "circle" | "cross" | "arrowup" | "arrowdown";
  readonly color?: string;
  readonly text?: string;
  readonly location?: "abovebar" | "belowbar";
}

export interface PineTsHLineOptions {
  readonly title?: string;
  readonly color?: string;
  readonly style?: "solid" | "dashed" | "dotted";
}

export interface PineTsStrategyContext {
  entry: (id: string, side?: "LONG" | "SHORT") => void;
  close: (id: string) => void;
}

export interface PineTsHelpers {
  plot: PineTsPlot;
  plotshape: (condition: boolean, options?: PineTsShapeOptions) => void;
  hline: (price: number, options?: PineTsHLineOptions) => void;
  strategy: PineTsStrategyContext;
  ta: typeof ta;
  math: typeof math;
  community: typeof community;
}

export interface PineTsPlot {
  (value: number, options?: PineTsPlotOptions): void;
  plot?: PineTsPlot;
  plotshape?: (condition: boolean, options?: PineTsShapeOptions) => void;
  hline?: (price: number, options?: PineTsHLineOptions) => void;
  strategy?: PineTsStrategyContext;
  ta?: typeof ta;
  math?: typeof math;
  community?: typeof community;
}

export type PineTsScript = (
  context: PineContext,
  plot: PineTsPlot,
  helpers?: PineTsHelpers
) => void;

export interface ExecutePineTsScriptOptions {
  readonly candles: readonly CandleData[];
  readonly symbol: string;
  readonly timeframe: string;
  readonly symbolInfo?: SymbolInfo;
  readonly script: PineTsScript | string;
}

export interface ExecutePineTsFullOptions extends ExecutePineTsScriptOptions {
  readonly scriptId?: string;
  readonly name?: string;
  readonly overlay?: boolean;
}

interface RuntimeState {
  plots: CustomPlotDef[];
  shapes: CustomShapeDef[];
  hlines: CustomHLineDef[];
  entryLong: boolean[];
  exitLong: boolean[];
  entryShort: boolean[];
  exitShort: boolean[];
  hasStrategyOrders: boolean;
}

const compileScriptCode = (code: string): PineTsScript => {
  const trimmed = code.trim().replace(/;+$/, "");
  if (trimmed.startsWith("(") || trimmed.startsWith("function") || trimmed.startsWith("async")) {
    const factory = new Function("ta", "math", "community", `return (${trimmed});`);
    const fn = factory(ta, math, community);
    return (ctx, plot, helpers) => {
      if (fn.length <= 2) fn(ctx, plot, helpers);
      else fn(ctx, helpers, ta, math, community);
    };
  }

  const hasPlotDecl = /\b(?:const|let|var)\s*\{[^}]*\bplot\b[^}]*\}\s*=/.test(code);
  const params = hasPlotDecl
    ? "ctx, helpers, ta, math, community"
    : "ctx, { plot, plotshape, hline, strategy }, helpers, ta, math, community";
  const factory = new Function("ta", "math", "community", `return (${params}) => { ${code} };`);
  const fn = factory(ta, math, community);
  return (ctx, plot, helpers) => fn(ctx, plot, helpers, ta, math, community);
};

const toPineBars = (candles: readonly CandleData[], symbol: string, timeframe: string): readonly Bar[] =>
  candles.map((candle) => ({
    time: Math.trunc(candle.time * 1000),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    isClosed: true,
    symbol,
    timeframe,
  }));

const createHelpers = (state: RuntimeState, context: PineContext): PineTsHelpers => {
  const barTime = Math.trunc(context.bar.time / 1000);
  const barIdx = context.bar_index.value ?? 0;
  let plotIdx = 0;

  const plot: PineTsPlot = (value, opts = {}) => {
    const curIdx = plotIdx++;
    let target = state.plots[curIdx];
    if (!target) {
      target = {
        id: `pine_ts_${curIdx}`,
        title: opts.title ?? `Plot ${curIdx + 1}`,
        color: opts.color ?? "#00E5FF",
        lineWidth: opts.lineWidth ?? 1.5,
        style: opts.style === "histogram" ? "histogram" : "line",
        data: [],
      };
      state.plots.push(target);
    }
    if (Number.isFinite(value)) target.data.push({ time: barTime, value });
  };

  const plotshape = (condition: boolean, opts: PineTsShapeOptions = {}) => {
    if (!condition) return;
    const isBelow = opts.location !== "abovebar";
    state.shapes.push({
      id: `shape_${state.shapes.length}`,
      time: barTime,
      price: isBelow ? context.bar.low * 0.998 : context.bar.high * 1.002,
      style: opts.style ?? (isBelow ? "triangleup" : "triangledown"),
      color: opts.color ?? (isBelow ? "#00F5A0" : "#FF495C"),
      text: opts.text ?? "",
    });
  };

  const hline = (price: number, opts: PineTsHLineOptions = {}) => {
    if (state.hlines.some((h) => h.price === price)) return;
    state.hlines.push({
      id: `hline_${state.hlines.length}`,
      price,
      title: opts.title ?? String(price),
      color: opts.color ?? "rgba(255, 255, 255, 0.4)",
      style: opts.style ?? "solid",
    });
  };

  const strategy: PineTsStrategyContext = {
    entry: (_id, side = "LONG") => {
      state.hasStrategyOrders = true;
      if (side === "LONG") state.entryLong[barIdx] = true;
      else state.entryShort[barIdx] = true;
    },
    close: (_id) => {
      state.hasStrategyOrders = true;
      state.exitLong[barIdx] = true;
      state.exitShort[barIdx] = true;
    },
  };

  const helpers: PineTsHelpers = { plot, plotshape, hline, strategy, ta, math, community };
  Object.assign(plot, helpers);
  return helpers;
};

const buildResult = (options: ExecutePineTsFullOptions, state: RuntimeState): ScriptExecutionResult => {
  const scriptType: ScriptType = state.hasStrategyOrders ? "strategy" : "indicator";
  const backtest = state.hasStrategyOrders
    ? runBacktest([...options.candles], state.entryLong, state.exitLong, state.entryShort, state.exitShort)
    : undefined;

  return {
    success: true,
    scriptId: options.scriptId ?? `pine_ts_${Date.now()}`,
    name: options.name ?? "Pine-TS Script",
    type: scriptType,
    overlay: options.overlay ?? true,
    plots: state.plots,
    shapes: state.shapes,
    hlines: state.hlines,
    trades: backtest?.trades,
    equityCurve: backtest?.equityCurve,
    stats: backtest?.stats,
    logs: [],
  };
};

export const executePineTsScriptFull = async (
  options: ExecutePineTsFullOptions
): Promise<ScriptExecutionResult> => {
  if (!options.candles?.length) {
    return {
      success: false,
      scriptId: options.scriptId ?? "err",
      name: options.name ?? "Pine-TS Script",
      type: "indicator",
      overlay: options.overlay ?? true,
      plots: [],
      shapes: [],
      hlines: [],
      logs: ["No candle data provided for Pine-TS execution"],
      error: "No candle data available",
    };
  }

  const bars = toPineBars(options.candles, options.symbol, options.timeframe);
  const symbolInfo = options.symbolInfo ?? { ticker: options.symbol, timezone: "UTC", type: "crypto" };
  const provider: MarketDataProvider = {
    getHistoricalBars: () => Promise.resolve(bars),
    streamBars: () => ({ [Symbol.asyncIterator]: async function* () { await Promise.resolve(); } }),
    getSymbolInfo: () => Promise.resolve(symbolInfo),
  };
  const runtime = new PineRuntime({ provider, symbol: options.symbol, timeframe: options.timeframe });
  const scriptFn = typeof options.script === "string" ? compileScriptCode(options.script) : options.script;
  const state: RuntimeState = {
    plots: [],
    shapes: [],
    hlines: [],
    entryLong: new Array(options.candles.length).fill(false),
    exitLong: new Array(options.candles.length).fill(false),
    entryShort: new Array(options.candles.length).fill(false),
    exitShort: new Array(options.candles.length).fill(false),
    hasStrategyOrders: false,
  };

  try {
    await runtime.run((ctx) => {
      const helpers = createHelpers(state, ctx);
      scriptFn(ctx, helpers.plot, helpers);
    }, bars);
    return buildResult(options, state);
  } catch (err: any) {
    return {
      success: false,
      scriptId: options.scriptId ?? "err",
      name: options.name ?? "Pine-TS Script",
      type: "indicator",
      overlay: options.overlay ?? true,
      plots: [],
      shapes: [],
      hlines: [],
      logs: [`Pine-TS error: ${err.message}`],
      error: err.message,
    };
  }
};

export const executePineTsScript = async (options: ExecutePineTsScriptOptions): Promise<CustomPlotDef[]> => {
  const result = await executePineTsScriptFull(options);
  return result.plots;
};