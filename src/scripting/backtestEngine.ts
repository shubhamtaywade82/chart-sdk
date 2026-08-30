import type { CandleData } from "./scriptSandbox";
import type {
  StrategyEquityPoint,
  StrategyStats,
  StrategyTrade,
} from "./types";

export interface BacktestConfig {
  initialCapital?: number;
  positionSizePercent?: number; // e.g. 0.5 for 50% capital per trade
  feePercent?: number; // e.g. 0.04% for Binance futures taker fee
}

export const runBacktest = (
  candles: CandleData[],
  entryLongSignals: boolean[] | number[],
  exitLongSignals: boolean[] | number[],
  entryShortSignals: boolean[] | number[] = [],
  exitShortSignals: boolean[] | number[] = [],
  config: BacktestConfig = {}
): { trades: StrategyTrade[]; equityCurve: StrategyEquityPoint[]; stats: StrategyStats } => {
  const initialCapital = config.initialCapital ?? 10000;
  const positionSize = config.positionSizePercent ?? 0.5;
  const feeRate = (config.feePercent ?? 0.04) / 100;

  let capital = initialCapital;
  let activePosition: {
    side: "LONG" | "SHORT";
    entryTime: number;
    entryPrice: number;
    size: number;
  } | null = null;

  const trades: StrategyTrade[] = [];
  const equityCurve: StrategyEquityPoint[] = [];
  let peakCapital = initialCapital;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const isLongEntry = Boolean(entryLongSignals[i]);
    const isLongExit = Boolean(exitLongSignals[i]);
    const isShortEntry = Boolean(entryShortSignals[i]);
    const isShortExit = Boolean(exitShortSignals[i]);

    // Handle Active Long Position Exit
    if (activePosition && activePosition.side === "LONG" && (isLongExit || isShortEntry)) {
      const exitPrice = candle.close;
      const grossProfit = (exitPrice - activePosition.entryPrice) * activePosition.size;
      const fee = (activePosition.entryPrice + exitPrice) * activePosition.size * feeRate;
      const netProfit = grossProfit - fee;
      const profitPercent = (netProfit / (activePosition.entryPrice * activePosition.size)) * 100;

      capital += netProfit;
      trades.push({
        id: trades.length + 1,
        entryTime: activePosition.entryTime,
        exitTime: candle.time,
        side: "LONG",
        entryPrice: activePosition.entryPrice,
        exitPrice,
        size: Number(activePosition.size.toFixed(4)),
        profit: Number(netProfit.toFixed(2)),
        profitPercent: Number(profitPercent.toFixed(2)),
        cumulativeProfit: Number((capital - initialCapital).toFixed(2)),
      });
      activePosition = null;
    }

    // Handle Active Short Position Exit
    if (activePosition && activePosition.side === "SHORT" && (isShortExit || isLongEntry)) {
      const exitPrice = candle.close;
      const grossProfit = (activePosition.entryPrice - exitPrice) * activePosition.size;
      const fee = (activePosition.entryPrice + exitPrice) * activePosition.size * feeRate;
      const netProfit = grossProfit - fee;
      const profitPercent = (netProfit / (activePosition.entryPrice * activePosition.size)) * 100;

      capital += netProfit;
      trades.push({
        id: trades.length + 1,
        entryTime: activePosition.entryTime,
        exitTime: candle.time,
        side: "SHORT",
        entryPrice: activePosition.entryPrice,
        exitPrice,
        size: Number(activePosition.size.toFixed(4)),
        profit: Number(netProfit.toFixed(2)),
        profitPercent: Number(profitPercent.toFixed(2)),
        cumulativeProfit: Number((capital - initialCapital).toFixed(2)),
      });
      activePosition = null;
    }

    // Open new Long
    if (!activePosition && isLongEntry) {
      const allocCapital = capital * positionSize;
      const size = allocCapital / candle.close;
      activePosition = {
        side: "LONG",
        entryTime: candle.time,
        entryPrice: candle.close,
        size,
      };
    } else if (!activePosition && isShortEntry) {
      // Open new Short
      const allocCapital = capital * positionSize;
      const size = allocCapital / candle.close;
      activePosition = {
        side: "SHORT",
        entryTime: candle.time,
        entryPrice: candle.close,
        size,
      };
    }

    // Mark-to-market current equity
    let currentEquity = capital;
    if (activePosition) {
      const pnl = activePosition.side === "LONG"
        ? (candle.close - activePosition.entryPrice) * activePosition.size
        : (activePosition.entryPrice - candle.close) * activePosition.size;
      currentEquity += pnl;
    }

    if (currentEquity > peakCapital) peakCapital = currentEquity;
    const drawdownPercent = peakCapital > 0 ? ((peakCapital - currentEquity) / peakCapital) * 100 : 0;

    equityCurve.push({
      time: candle.time,
      equity: Number(currentEquity.toFixed(2)),
      drawdownPercent: Number(drawdownPercent.toFixed(2)),
    });
  }

  // Compute Statistics
  const winning = trades.filter((t) => t.profit > 0);
  const losing = trades.filter((t) => t.profit < 0);
  const grossProfit = winning.reduce((sum, t) => sum + t.profit, 0);
  const grossLoss = Math.abs(losing.reduce((sum, t) => sum + t.profit, 0));
  const maxDrawdown = Math.max(0, ...equityCurve.map((e) => e.drawdownPercent));

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev > 0) returns.push((equityCurve[i].equity - prev) / prev);
  }
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length || 1);
  const stdev = Math.sqrt(variance);
  const sharpe = stdev > 0 ? (avgReturn / stdev) * Math.sqrt(365 * 24) : 0;

  const stats: StrategyStats = {
    initialCapital,
    finalEquity: equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : initialCapital,
    netProfit: Number((capital - initialCapital).toFixed(2)),
    netProfitPercent: Number((((capital - initialCapital) / initialCapital) * 100).toFixed(2)),
    totalTrades: trades.length,
    winningTrades: winning.length,
    losingTrades: losing.length,
    winRate: trades.length > 0 ? Number(((winning.length / trades.length) * 100).toFixed(2)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 999 : 0,
    maxDrawdownPercent: Number(maxDrawdown.toFixed(2)),
    sharpeRatio: Number(sharpe.toFixed(2)),
    averageTradeProfit: trades.length > 0 ? Number(((capital - initialCapital) / trades.length).toFixed(2)) : 0,
  };

  return { trades, equityCurve, stats };
};
