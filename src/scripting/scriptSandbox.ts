import {
  taSma,
  taEma,
  taRsi,
  taMacd,
  taAtr,
  taStoch,
  taTrueRange,
  taHighest,
  taLowest,
  taCrossover,
  taCrossunder,
  taBollingerBands,
} from "./taMath";
import { transpilePineToJs } from "./pineTranspiler";
import type {
  CustomHLineDef,
  CustomPlotDef,
  CustomShapeDef,
  ScriptExecutionResult,
  ScriptLanguage,
} from "./types";

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RawStrategySignal {
  type: "entry" | "close" | "exit";
  id: string;
  side?: "LONG" | "SHORT";
  index: number;
  time: number;
  price: number;
  stop?: number;
  limit?: number;
}

export const executeScript = (
  code: string,
  language: ScriptLanguage,
  candles: CandleData[],
  inputs: Record<string, any> = {}
): ScriptExecutionResult & { rawSignals?: RawStrategySignal[] } => {
  const logs: string[] = [];
  const plots: CustomPlotDef[] = [];
  const shapes: CustomShapeDef[] = [];
  const hlines: CustomHLineDef[] = [];
  const rawSignals: RawStrategySignal[] = [];

  if (!candles || candles.length === 0) {
    return {
      success: false,
      scriptId: "err",
      name: "Empty Data",
      type: "indicator",
      overlay: true,
      plots: [],
      shapes: [],
      hlines: [],
      logs: ["No candle data provided for script execution"],
      error: "No candle data available",
    };
  }

  const times = candles.map((c) => c.time);
  const opens = candles.map((c) => c.open);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  let scriptTitle = "Custom Script";
  let isOverlay = true;
  let scriptType: "indicator" | "strategy" = "indicator";
  let executableCode = code;

  if (language === "pine") {
    try {
      const transpiled = transpilePineToJs(code);
      executableCode = transpiled.jsCode;
      scriptTitle = transpiled.title;
      isOverlay = transpiled.overlay;
      scriptType = transpiled.type;
    } catch (e: any) {
      return {
        success: false,
        scriptId: "parse-err",
        name: "Compilation Error",
        type: "indicator",
        overlay: true,
        plots: [],
        shapes: [],
        hlines: [],
        logs: [`Transpilation error: ${e.message}`],
        error: e.message,
      };
    }
  }

  const _lag = (series: number[], n: number): number[] => {
    const res = new Array(series.length).fill(NaN);
    for (let i = n; i < series.length; i++) {
      res[i] = series[i - n];
    }
    return res;
  };

  const plot = (series: number[] | number, opts: any = {}) => {
    const title = opts.title || `Plot ${plots.length + 1}`;
    const color = opts.color || "#00E5FF";
    const lineWidth = opts.linewidth || opts.lineWidth || 1.5;
    const style = opts.style === "histogram" ? "histogram" : "line";

    const data: { time: number; value: number }[] = [];
    if (Array.isArray(series)) {
      for (let i = 0; i < series.length; i++) {
        const val = series[i];
        if (typeof val === "number" && !isNaN(val)) {
          data.push({ time: times[i], value: Number(val.toFixed(4)) });
        }
      }
    } else if (typeof series === "number" && !isNaN(series)) {
      data.push({ time: times[times.length - 1], value: series });
    }

    plots.push({ id: `plot_${plots.length}`, title, color, lineWidth, style, data });
  };

  const plotshape = (condition: boolean[] | boolean, opts: any = {}) => {
    const color = opts.color || "#00F5A0";
    const text = opts.text || "";
    const isBelow = opts.location === "belowbar" || opts.location === "bottom";

    if (Array.isArray(condition)) {
      for (let i = 0; i < condition.length; i++) {
        if (condition[i]) {
          shapes.push({
            id: `shape_${shapes.length}`,
            time: times[i],
            price: isBelow ? lows[i] * 0.998 : highs[i] * 1.002,
            style: isBelow ? "triangleup" : "triangledown",
            color,
            text,
          });
        }
      }
    }
  };

  const hline = (price: number, opts: any = {}) => {
    hlines.push({
      id: `hline_${hlines.length}`,
      price,
      title: opts.title || `${price}`,
      color: opts.color || "rgba(255, 255, 255, 0.4)",
      style: opts.linestyle === "dashed" ? "dashed" : "solid",
    });
  };

  const strategy = {
    long: "LONG" as const,
    short: "SHORT" as const,
    position_size: 0,
    position_avg_price: 0,
    equity: 10000,
    entry: (id: string, side: "LONG" | "SHORT", opts: any = {}) => {
      const idx = closes.length - 1;
      rawSignals.push({
        type: "entry",
        id,
        side: side || "LONG",
        index: idx,
        time: times[idx],
        price: closes[idx],
        stop: opts.stop,
        limit: opts.limit,
      });
    },
    close: (id: string) => {
      const idx = closes.length - 1;
      rawSignals.push({
        type: "close",
        id,
        index: idx,
        time: times[idx],
        price: closes[idx],
      });
    },
  };

  const ta = {
    ema: (src: number[], len: number) => taEma(src, len),
    sma: (src: number[], len: number) => taSma(src, len),
    rsi: (src: number[], len = 14) => taRsi(src, len),
    macd: (src: number[], fast = 12, slow = 26, sig = 9) => {
      const res = taMacd(src, fast, slow, sig);
      return [res.macd, res.signal, res.hist];
    },
    atr: (len = 14) => taAtr(candles, len),
    stoch: (k = 14, d = 3, smooth = 3) => {
      const res = taStoch(candles, k, d, smooth);
      return [res.k, res.d];
    },
    tr: () => taTrueRange(candles),
    highest: (src: number[], len: number) => taHighest(src, len),
    lowest: (src: number[], len: number) => taLowest(src, len),
    crossover: (a: number[], b: number[]) => taCrossover(a, b),
    crossunder: (a: number[], b: number[]) => taCrossunder(a, b),
    bb: (src: number[], len = 20, mult = 2) => {
      const res = taBollingerBands(src, len, mult);
      return [res.middle, res.upper, res.lower];
    },
    change: (src: number[], len = 1): number[] => {
      const res = new Array(src.length).fill(NaN);
      for (let i = len; i < src.length; i++) {
        res[i] = src[i] - src[i - len];
      }
      return res;
    },
    cum: (src: number[]): number[] => {
      const res = new Array(src.length).fill(0);
      let sum = 0;
      for (let i = 0; i < src.length; i++) {
        sum += src[i] || 0;
        res[i] = sum;
      }
      return res;
    },
  };

  const str = {
    tostring: (val: any) => String(val),
    format: (formatStr: string, ...args: any[]) => {
      let result = formatStr;
      args.forEach((a, i) => {
        result = result.replace(`{${i}}`, String(a));
      });
      return result;
    },
    length: (s: string) => (s ? s.length : 0),
    contains: (source: string, target: string) => (source ? source.includes(target) : false),
  };

  const color = {
    blue: "#2962FF",
    red: "#FF495C",
    green: "#00F5A0",
    purple: "#A855F7",
    yellow: "#FFD700",
    orange: "#FFA726",
    aqua: "#00E5FF",
    white: "#FFFFFF",
    black: "#000000",
    gray: "#787B86",
    teal: "#00B4D8",
    new: (base: string, transp: number) => {
      const alpha = Math.max(0, Math.min(1, (100 - transp) / 100));
      return base.startsWith("#") ? `${base}${Math.round(alpha * 255).toString(16).padStart(2, "0")}` : base;
    },
    rgb: (r: number, g: number, b: number, a = 1) => `rgba(${r}, ${g}, ${b}, ${a})`,
  };

  const sandboxContext = {
    open: opens,
    high: highs,
    low: lows,
    close: closes,
    volume: volumes,
    time: times,
    inputs,
    _lag,
    ta,
    math: {
      ...Math,
      avg: (...nums: number[]) => nums.reduce((a, b) => a + b, 0) / (nums.length || 1),
      sign: (x: number) => Math.sign(x),
    },
    str,
    color,
    plot,
    plotshape,
    hline,
    strategy,
    shape: { triangleup: "triangleup", triangledown: "triangledown", circle: "circle", cross: "cross" },
    location: { abovebar: "abovebar", belowbar: "belowbar", top: "top", bottom: "bottom" },
    size: { small: "small", normal: "normal", large: "large" },
    console: {
      log: (...args: any[]) => logs.push(args.map((a) => String(a)).join(" ")),
      error: (...args: any[]) => logs.push(`[ERR] ${args.map((a) => String(a)).join(" ")}`),
    },
  };

  try {
    const sandboxKeys = Object.keys(sandboxContext);
    const sandboxValues = Object.values(sandboxContext);
    const fn = new Function(...sandboxKeys, `"use strict";\n${executableCode}`);
    fn(...sandboxValues);

    return {
      success: true,
      scriptId: `script_${Date.now()}`,
      name: scriptTitle,
      type: scriptType,
      overlay: isOverlay,
      plots,
      shapes,
      hlines,
      logs,
      rawSignals,
    };
  } catch (err: any) {
    return {
      success: false,
      scriptId: "exec-err",
      name: scriptTitle,
      type: scriptType,
      overlay: isOverlay,
      plots: [],
      shapes: [],
      hlines: [],
      logs: [...logs, `Runtime error: ${err.message}`],
      error: err.message,
    };
  }
};
