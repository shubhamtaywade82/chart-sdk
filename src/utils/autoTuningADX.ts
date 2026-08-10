import type { Candle } from "../adapters/IDataAdapter";

export interface ADXSeriesResult {
  adx: number[];
  diPlus: number[];
  diMinus: number[];
  times: number[];
  lastADX: number;
  lastPlusDI: number;
  lastMinusDI: number;
}

export interface ADXBacktestTrade {
  entryIndex: number;
  exitIndex: number;
  entryTime: number;
  exitTime: number;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  exitReason: "CROSS" | "WEAK_ADX" | "END_OF_DATA";
}

export interface ADXBacktestResult {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  netProfitPct: number;
  maxDrawdownPct: number;
  trades: ADXBacktestTrade[];
}

export interface ADXCandidateResult {
  length: number;
  threshold: number;
  score: number;
  winRate: number;
  profitFactor: number;
  netProfitPct: number;
  maxDrawdownPct: number;
  totalTrades: number;
  result: ADXBacktestResult;
}

export interface ADXOptimizationResult {
  bestLength: number;
  bestThreshold: number;
  bestScore: number;
  bestResult: ADXBacktestResult;
  allResults: ADXCandidateResult[];
  evaluatedAt: number;
  symbol: string;
  interval: string;
}

export class AutoTuningADX {
  private static cache = new Map<string, ADXOptimizationResult>();

  /**
   * Calculates Wilder's smoothed ADX, +DI, and -DI series for a candle array.
   */
  public static calculate(candles: Candle[], length: number = 14): ADXSeriesResult {
    const defaultRes: ADXSeriesResult = {
      adx: [],
      diPlus: [],
      diMinus: [],
      times: [],
      lastADX: 22,
      lastPlusDI: 20,
      lastMinusDI: 20,
    };
    if (!candles || candles.length < length * 2) return defaultRes;

    const trArr: number[] = [];
    const plusDMArr: number[] = [];
    const minusDMArr: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const curr = candles[i];
      const prev = candles[i - 1];

      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      );
      trArr.push(tr);

      const upMove = curr.high - prev.high;
      const downMove = prev.low - curr.low;

      plusDMArr.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMArr.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }

    // Seed sums
    let smoothTR = trArr.slice(0, length).reduce((a, b) => a + b, 0);
    let smoothPlusDM = plusDMArr.slice(0, length).reduce((a, b) => a + b, 0);
    let smoothMinusDM = minusDMArr.slice(0, length).reduce((a, b) => a + b, 0);

    const diPlus: number[] = [];
    const diMinus: number[] = [];
    const dxArr: number[] = [];
    const times: number[] = [];

    for (let i = length; i < trArr.length; i++) {
      smoothTR = smoothTR - smoothTR / length + trArr[i];
      smoothPlusDM = smoothPlusDM - smoothPlusDM / length + plusDMArr[i];
      smoothMinusDM = smoothMinusDM - smoothMinusDM / length + minusDMArr[i];

      const pDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
      const mDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
      const diSum = pDI + mDI;
      const dx = diSum > 0 ? (Math.abs(pDI - mDI) / diSum) * 100 : 0;

      diPlus.push(Number(pDI.toFixed(2)));
      diMinus.push(Number(mDI.toFixed(2)));
      dxArr.push(dx);
      times.push(candles[i + 1]?.time ?? candles[i].time);
    }

    if (dxArr.length < length) return defaultRes;

    // Smoothed ADX
    const adx: number[] = [];
    let smoothDX = dxArr.slice(0, length).reduce((a, b) => a + b, 0) / length;
    adx.push(Number(smoothDX.toFixed(2)));

    for (let i = length; i < dxArr.length; i++) {
      smoothDX = (smoothDX * (length - 1) + dxArr[i]) / length;
      adx.push(Number(smoothDX.toFixed(2)));
    }

    const lastADX = adx[adx.length - 1] ?? 22;
    const lastPlusDI = diPlus[diPlus.length - 1] ?? 20;
    const lastMinusDI = diMinus[diMinus.length - 1] ?? 20;

    return {
      adx,
      diPlus: diPlus.slice(-adx.length),
      diMinus: diMinus.slice(-adx.length),
      times: times.slice(-adx.length),
      lastADX,
      lastPlusDI,
      lastMinusDI,
    };
  }

  /**
   * Fast event-driven backtest for an ADX + DI directional breakout system.
   */
  public static backtest(candles: Candle[], adxResult: ADXSeriesResult, threshold: number): ADXBacktestResult {
    const trades: ADXBacktestTrade[] = [];
    const len = adxResult.adx.length;
    if (len < 10) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        profitFactor: 1.0,
        netProfitPct: 0,
        maxDrawdownPct: 0,
        trades: [],
      };
    }

    const candleOffset = candles.length - len;
    let position: "LONG" | "SHORT" | null = null;
    let entryIdx = 0;
    let entryPrice = 0;
    let entryTime = 0;

    let grossWin = 0;
    let grossLoss = 0;
    let peakEquity = 100;
    let currentEquity = 100;
    let maxDrawdownPct = 0;

    for (let i = 1; i < len; i++) {
      const c = candles[candleOffset + i];
      if (!c) continue;

      const adxVal = adxResult.adx[i];
      const pDI = adxResult.diPlus[i];
      const mDI = adxResult.diMinus[i];

      if (position === null) {
        // Entry condition: ADX above threshold and clear DI divergence
        if (adxVal >= threshold && pDI > mDI + 2) {
          position = "LONG";
          entryIdx = i;
          entryPrice = c.close;
          entryTime = c.time;
        } else if (adxVal >= threshold && mDI > pDI + 2) {
          position = "SHORT";
          entryIdx = i;
          entryPrice = c.close;
          entryTime = c.time;
        }
      } else {
        // Exit conditions: ADX weakens below threshold OR opposite DI cross
        const isLongExit = position === "LONG" && (pDI < mDI || adxVal < threshold - 3);
        const isShortExit = position === "SHORT" && (mDI < pDI || adxVal < threshold - 3);

        if (isLongExit || isShortExit || i === len - 1) {
          const mult = position === "LONG" ? 1 : -1;
          const pnlPct = entryPrice > 0 ? mult * ((c.close - entryPrice) / entryPrice) * 100 : 0;
          const reason = adxVal < threshold - 3 ? "WEAK_ADX" : i === len - 1 ? "END_OF_DATA" : "CROSS";

          trades.push({
            entryIndex: entryIdx,
            exitIndex: i,
            entryTime,
            exitTime: c.time,
            side: position,
            entryPrice,
            exitPrice: c.close,
            pnlPct: Number(pnlPct.toFixed(2)),
            exitReason: reason,
          });

          if (pnlPct > 0) grossWin += pnlPct;
          else grossLoss += Math.abs(pnlPct);

          currentEquity *= 1 + pnlPct / 100;
          if (currentEquity > peakEquity) peakEquity = currentEquity;
          const dd = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;
          if (dd > maxDrawdownPct) maxDrawdownPct = dd;

          position = null;
        }
      }
    }

    const winTrades = trades.filter((t) => t.pnlPct > 0).length;
    const lossTrades = trades.filter((t) => t.pnlPct <= 0).length;
    const winRate = trades.length > 0 ? (winTrades / trades.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 5.0 : 1.0;
    const netProfitPct = currentEquity - 100;

    return {
      totalTrades: trades.length,
      winningTrades: winTrades,
      losingTrades: lossTrades,
      winRate: Number(winRate.toFixed(1)),
      profitFactor: Number(Math.min(9.99, profitFactor).toFixed(2)),
      netProfitPct: Number(netProfitPct.toFixed(2)),
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      trades,
    };
  }

  /**
   * Grid search auto-optimizer to find the highest-fitness length and threshold.
   */
  public static optimize(
    candles: Candle[],
    symbol: string = "default",
    interval: string = "15m",
    lengthRange = { min: 8, max: 20, step: 2 },
    thresholdRange = { min: 18, max: 32, step: 2 }
  ): ADXOptimizationResult {
    const candidates: ADXCandidateResult[] = [];

    for (let l = lengthRange.min; l <= lengthRange.max; l += lengthRange.step) {
      const adxRes = this.calculate(candles, l);
      for (let th = thresholdRange.min; th <= thresholdRange.max; th += thresholdRange.step) {
        const bt = this.backtest(candles, adxRes, th);
        if (bt.totalTrades < 3) continue;

        // Composite scoring fitness function
        const score = Number(
          (
            bt.winRate * 0.4 +
            Math.min(bt.profitFactor, 4.0) * 12 +
            Math.min(bt.netProfitPct, 50) * 0.5 -
            bt.maxDrawdownPct * 1.2
          ).toFixed(2)
        );

        candidates.push({
          length: l,
          threshold: th,
          score,
          winRate: bt.winRate,
          profitFactor: bt.profitFactor,
          netProfitPct: bt.netProfitPct,
          maxDrawdownPct: bt.maxDrawdownPct,
          totalTrades: bt.totalTrades,
          result: bt,
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    const best = candidates[0] || {
      length: 14,
      threshold: 25,
      score: 50,
      winRate: 50,
      profitFactor: 1.5,
      netProfitPct: 0,
      maxDrawdownPct: 5,
      totalTrades: 0,
      result: {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        profitFactor: 1.0,
        netProfitPct: 0,
        maxDrawdownPct: 0,
        trades: [],
      },
    };

    const optResult: ADXOptimizationResult = {
      bestLength: best.length,
      bestThreshold: best.threshold,
      bestScore: best.score,
      bestResult: best.result,
      allResults: candidates,
      evaluatedAt: Date.now(),
      symbol,
      interval,
    };

    const key = `${symbol.toLowerCase()}_${interval}`;
    this.cache.set(key, optResult);
    return optResult;
  }

  /**
   * Retrieves or computes the tuned parameters for the current symbol and interval.
   */
  public static getTuned(
    candles: Candle[],
    symbol: string = "default",
    interval: string = "15m"
  ): ADXOptimizationResult {
    const key = `${symbol.toLowerCase()}_${interval}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.evaluatedAt < 120000) {
      return cached;
    }
    return this.optimize(candles, symbol, interval);
  }
}
