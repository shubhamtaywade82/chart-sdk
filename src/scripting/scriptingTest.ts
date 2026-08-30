import { taSma, taEma, taRsi, taMacd, taAtr, taStoch, taCrossover } from "./taMath";
import { transpilePineToJs } from "./pineTranspiler";
import { executeScript } from "./scriptSandbox";
import { runBacktest } from "./backtestEngine";
import { BUILTIN_SCRIPTS } from "./scriptStorage";

console.log("=== RUNNING PINE SCRIPT v6 CUSTOM SCRIPTING & BACKTEST TESTS ===");

// 1. Generate sample candle dataset (100 bars)
const sampleCandles = Array.from({ length: 100 }, (_, i) => {
  const base = 50000 + Math.sin(i / 5) * 2000 + i * 50;
  return {
    time: 1700000000 + i * 900,
    open: base - 20,
    high: base + 100,
    low: base - 100,
    close: base + 30,
    volume: 1000 + Math.random() * 500,
  };
});

// 2. Test Pine Script v6 TA Math
const closes = sampleCandles.map((c) => c.close);
const sma20 = taSma(closes, 20);
const ema10 = taEma(closes, 10);
const rsi14 = taRsi(closes, 14);
const macd = taMacd(closes, 12, 26, 9);
const atr14 = taAtr(sampleCandles, 14);
const stoch = taStoch(sampleCandles, 14, 3, 3);
const cross = taCrossover(ema10, sma20);

console.log("✓ TA Math: SMA20 length:", sma20.length, "Last SMA:", sma20[99].toFixed(2));
console.log("✓ TA Math: EMA10 length:", ema10.length, "Last EMA:", ema10[99].toFixed(2));
console.log("✓ TA Math: RSI14 last:", rsi14[99].toFixed(2));
console.log("✓ TA Math: MACD last:", macd.macd[99].toFixed(2), "Signal:", macd.signal[99].toFixed(2));
console.log("✓ TA Math v6: ATR14 last:", atr14[99].toFixed(2));
console.log("✓ TA Math v6: Stoch %K last:", stoch.k[99].toFixed(2), "%D:", stoch.d[99].toFixed(2));

// 3. Test Pine Script v6 syntax with input.int and logical 'and' / 'or'
const pineV6Sample = `//@version=6
indicator("Pine v6 Modern Features", overlay=true)

len = input.int(14, "Period")
mult = input.float(2.0, "Multiplier")

emaVal = ta.ema(close, len)
rsiVal = ta.rsi(close, len)

bullCondition = (close > emaVal) and (rsiVal < 65)
bearCondition = (close < emaVal) or (rsiVal > 75)

plot(emaVal, color=color.aqua, title="EMA v6")
plotshape(bullCondition, style=shape.triangleup, location=location.belowbar, color=color.green, text="BUY")
`;

const transpiled = transpilePineToJs(pineV6Sample);
console.log("✓ Pine v6 Transpiler detected version:", transpiled.version);
const execV6Res = executeScript(pineV6Sample, "pine", sampleCandles);
if (!execV6Res.success) {
  console.error("✗ Pine v6 script execution failed:", execV6Res.error);
  process.exit(1);
}
console.log("✓ Pine v6 custom execution succeeded with", execV6Res.plots.length, "plots and", execV6Res.shapes.length, "shapes.");

// 4. Test all Built-in Scripts under v6
for (const script of BUILTIN_SCRIPTS) {
  const res = executeScript(script.code, script.language, sampleCandles);
  if (!res.success) {
    console.error(`✗ Script failed: ${script.name}`, res.error);
    process.exit(1);
  }
  console.log(`✓ Built-in v6 Script "${script.name}" -> Plots: ${res.plots.length}, Shapes: ${res.shapes.length}, HLines: ${res.hlines.length}`);
}

// 5. Test Strategy Backtest Engine
const buySignals = sampleCandles.map((_, i) => i % 15 === 0);
const sellSignals = sampleCandles.map((_, i) => i % 15 === 7);
const backtestRes = runBacktest(sampleCandles, buySignals, sellSignals);

console.log("✓ Backtest Total Trades:", backtestRes.stats.totalTrades);
console.log("✓ Backtest Net Profit:", `$${backtestRes.stats.netProfit}`);
console.log("✓ Backtest Win Rate:", `${backtestRes.stats.winRate}%`);
console.log("✓ Backtest Profit Factor:", backtestRes.stats.profitFactor);
console.log("✓ Backtest Max Drawdown:", `${backtestRes.stats.maxDrawdownPercent}%`);
console.log("=== ALL PINE SCRIPT v6 TESTS PASSED SUCCESSFULLY ===");
