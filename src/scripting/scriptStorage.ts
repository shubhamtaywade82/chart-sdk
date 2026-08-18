import type { UserScript } from "./types";

export const BUILTIN_SCRIPTS: UserScript[] = [
  {
    id: "builtin_ema_cross",
    name: "EMA Cross (12 / 26)",
    type: "indicator",
    language: "pine",
    overlay: true,
    isBuiltIn: true,
    updatedAt: Date.now(),
    code: `//@version=6
indicator("EMA Cross", overlay=true)

fastLength = input.int(12, "Fast Length")
slowLength = input.int(26, "Slow Length")

fastEMA = ta.ema(close, fastLength)
slowEMA = ta.ema(close, slowLength)

plot(fastEMA, color=color.aqua, title="Fast EMA", linewidth=2)
plot(slowEMA, color=color.orange, title="Slow EMA", linewidth=2)

bullCross = ta.crossover(fastEMA, slowEMA)
bearCross = ta.crossunder(fastEMA, slowEMA)

plotshape(bullCross, style=shape.triangleup, location=location.belowbar, color=color.green, text="BUY")
plotshape(bearCross, style=shape.triangledown, location=location.abovebar, color=color.red, text="SELL")
`,
  },
  {
    id: "builtin_rsi_oscillator",
    name: "RSI Divergence Oscillator",
    type: "indicator",
    language: "pine",
    overlay: false,
    isBuiltIn: true,
    updatedAt: Date.now(),
    code: `//@version=6
indicator("RSI Divergence", overlay=false)

rsiLength = input.int(14, "RSI Length")
overbought = input.int(70, "Overbought Level")
oversold = input.int(30, "Oversold Level")

rsiVal = ta.rsi(close, rsiLength)

plot(rsiVal, color=color.purple, title="RSI", linewidth=2)
hline(overbought, color=color.red, title="Overbought 70")
hline(oversold, color=color.green, title="Oversold 30")
`,
  },
  {
    id: "builtin_macd",
    name: "MACD Indicator (12, 26, 9)",
    type: "indicator",
    language: "pine",
    overlay: false,
    isBuiltIn: true,
    updatedAt: Date.now(),
    code: `//@version=6
indicator("MACD", overlay=false)

fastLen = input.int(12, "Fast Length")
slowLen = input.int(26, "Slow Length")
sigLen = input.int(9, "Signal Length")

fastEma = ta.ema(close, fastLen)
slowEma = ta.ema(close, slowLen)
macdLine = fastEma - slowEma
signalLine = ta.ema(macdLine, sigLen)
hist = macdLine - signalLine

plot(macdLine, color=color.blue, title="MACD", linewidth=2)
plot(signalLine, color=color.orange, title="Signal", linewidth=1.5)
plot(hist, color=color.aqua, style="histogram", title="Histogram")
hline(0, color=color.gray, title="Zero")
`,
  },
  {
    id: "builtin_bollinger_bands",
    name: "Bollinger Bands (20, 2.0)",
    type: "indicator",
    language: "pine",
    overlay: true,
    isBuiltIn: true,
    updatedAt: Date.now(),
    code: `//@version=6
indicator("Bollinger Bands", overlay=true)

length = input.int(20, "Length")
mult = input.float(2.0, "StdDev Multiplier")

basis = ta.sma(close, length)
upper = basis + mult * 2.0
lower = basis - mult * 2.0

plot(basis, color=color.yellow, title="Basis SMA", linewidth=1.5)
plot(upper, color=color.aqua, title="Upper Band", linewidth=1.5)
plot(lower, color=color.aqua, title="Lower Band", linewidth=1.5)
`,
  },
  {
    id: "builtin_ma_crossover_strat",
    name: "MA Crossover Strategy",
    type: "strategy",
    language: "pine",
    overlay: true,
    isBuiltIn: true,
    updatedAt: Date.now(),
    code: `//@version=6
strategy("MA Crossover Strategy", overlay=true)

fastLength = input.int(10, "Fast MA Length")
slowLength = input.int(20, "Slow MA Length")

fastMA = ta.sma(close, fastLength)
slowMA = ta.sma(close, slowLength)

plot(fastMA, color=color.aqua, title="Fast SMA", linewidth=2)
plot(slowMA, color=color.orange, title="Slow SMA", linewidth=2)

longCondition = ta.crossover(fastMA, slowMA)
if (longCondition)
    strategy.entry("Long", strategy.long)

shortCondition = ta.crossunder(fastMA, slowMA)
if (shortCondition)
    strategy.close("Long")
`,
  },
  {
    id: "builtin_rsi_mean_rev_strat",
    name: "RSI Mean Reversion Strategy",
    type: "strategy",
    language: "pine",
    overlay: false,
    isBuiltIn: true,
    updatedAt: Date.now(),
    code: `//@version=6
strategy("RSI Mean Reversion", overlay=false)

rsiLength = input.int(14, "RSI Length")
oversold = input.int(30, "Oversold Entry")
overbought = input.int(70, "Overbought Exit")

rsiValue = ta.rsi(close, rsiLength)

plot(rsiValue, color=color.purple, title="RSI", linewidth=2)
hline(overbought, color=color.red, title="Exit 70")
hline(oversold, color=color.green, title="Entry 30")

if (rsiValue < oversold)
    strategy.entry("Long", strategy.long)

if (rsiValue > overbought)
    strategy.close("Long")
`,
  },
  {
    id: "builtin_microstructure_breakout",
    name: "Microstructure Breakout & Volume Filter",
    type: "indicator",
    language: "pine",
    overlay: true,
    isBuiltIn: true,
    updatedAt: Date.now(),
    code: `//@version=6
indicator("Microstructure Breakout & Volume Filter", overlay=true)

lookback = input.int(20, "Lookback Length")
volMult = input.float(1.5, "Volume Multiplier")

highestHigh = ta.highest(high, lookback)
lowestLow = ta.lowest(low, lookback)
avgVol = ta.sma(volume, 20)

isBullBreak = ta.crossover(close, highestHigh[1]) and volume > avgVol * volMult
isBearBreak = ta.crossunder(close, lowestLow[1]) and volume > avgVol * volMult

plot(highestHigh, color=color.aqua, title="Swing High", linewidth=1)
plot(lowestLow, color=color.orange, title="Swing Low", linewidth=1)
plotshape(isBullBreak, style=shape.triangleup, location=location.belowbar, color=color.green, text="BREAK LONG")
plotshape(isBearBreak, style=shape.triangledown, location=location.abovebar, color=color.red, text="BREAK SHORT")
`,
  },
  {
    id: "builtin_orderflow_breakout_strat",
    name: "Order Flow Breakout Strategy",
    type: "strategy",
    language: "pine",
    overlay: true,
    isBuiltIn: true,
    updatedAt: Date.now(),
    code: `//@version=6
strategy("Order Flow Breakout Strategy", overlay=true)

lookback = input.int(20, "Lookback Range")
volMult = input.float(1.5, "Volume Multiplier")

highestHigh = ta.highest(high, lookback)
lowestLow = ta.lowest(low, lookback)
avgVol = ta.sma(volume, 20)

isBullBreak = ta.crossover(close, highestHigh[1]) and volume > avgVol * volMult
isBearBreak = ta.crossunder(close, lowestLow[1]) and volume > avgVol * volMult

if (isBullBreak)
    strategy.entry("Break Long", strategy.long)

if (isBearBreak)
    strategy.close("Break Long")
`,
  },
];

const STORAGE_KEY = "chart_custom_scripts";

export const getSavedScripts = (): UserScript[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const userScripts: UserScript[] = JSON.parse(raw);
      return [...BUILTIN_SCRIPTS, ...userScripts];
    }
  } catch {}
  return [...BUILTIN_SCRIPTS];
};

export const saveUserScript = (script: Omit<UserScript, "updatedAt">): UserScript => {
  const updatedScript: UserScript = {
    ...script,
    updatedAt: Date.now(),
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const existing: UserScript[] = raw ? JSON.parse(raw) : [];
    const idx = existing.findIndex((s) => s.id === script.id);

    if (idx >= 0) {
      existing[idx] = updatedScript;
    } else {
      existing.push(updatedScript);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch {}

  return updatedScript;
};

export const deleteUserScript = (id: string): void => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const existing: UserScript[] = JSON.parse(raw);
    const filtered = existing.filter((s) => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {}
};

export const exportScriptFile = (script: UserScript): void => {
  const blob = new Blob([script.code], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${script.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}.pine`;
  a.click();
  URL.revokeObjectURL(url);
};
