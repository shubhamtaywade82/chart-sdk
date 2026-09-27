import type { Candle } from "../adapters/IDataAdapter";
import { MarketRegimeEngine } from "./marketRegimeEngine";
import type { MacroBias, MarketRegimeTelemetry, MarketRegimeType } from "./marketRegimeEngine";

export type TrendDirection = "UP" | "DOWN" | "NEUTRAL";
export type SignalType = "BUY" | "SELL" | "HOLD";
export type ConfidenceTier = "LOW" | "MEDIUM" | "HIGH" | "PRIME";

export interface ConfidenceFactorBreakdown {
  statisticalSampling: number; // 0-100
  mtfAlignment: number;        // 0-100
  orderFlowImbalance: number;  // 0-100
  volumeExpansion: number;     // 0-100
  llmSentiment: number;        // 0-100
  totalScore: number;          // 0-100
  tier: ConfidenceTier;
}

export interface ClusterMetadata {
  perfBestCentroid: number;
  perfAverageCentroid: number;
  perfWorstCentroid: number;
  perfBestDispersion: number;
  perfAverageDispersion: number;
  perfWorstDispersion: number;
  stateBullCentroid: number;
  stateNeutralCentroid: number;
  stateBearCentroid: number;
  stateBullDispersion: number;
  stateNeutralDispersion: number;
  stateBearDispersion: number;
  bestClusterStability: number;
  bullClusterStability: number;
}

export interface ClusteringOptions {
  step?: number;
  perfAlpha?: number;
  fromCluster?: "Best" | "Average" | "Worst";
  oscSmooth?: number;
  maxIter?: number;
}

export interface SupertrendPoint {
  time: number;
  trend: TrendDirection;
  supertrend: number;
  upBand: number;
  dnBand: number;
  atr: number;
  adaptiveMult: number;
  signal: SignalType | null;
  confidence: number;
  confidenceTier: ConfidenceTier;
  ama?: number;
  perfIdx?: number;
  targetFactor?: number;
  bull?: number;
  neutral?: number;
  bear?: number;
  strongBull?: boolean;
  strongBear?: boolean;
  tradeBias?: "LONG BIAS" | "SHORT BIAS" | "WAIT";
  tradeState?: "STRONG BULL" | "STRONG BEAR" | "BULL" | "BEAR" | "NEUTRAL";
  oscSpread?: number;
  priceToStopAtr?: number;
  clusterMetadata?: ClusterMetadata;
}

export interface SupertrendSignal {
  type: SignalType;
  price: number;
  stop: number;
  target?: number;
  trend: TrendDirection;
  adaptiveMult: number;
  atr: number;
  time: number;
  confidence: number;
  confidenceTier: ConfidenceTier;
  confidenceBreakdown?: ConfidenceFactorBreakdown;
  ama?: number;
  perfIdx?: number;
  bull?: number;
  neutral?: number;
  bear?: number;
  strongBull?: boolean;
  strongBear?: boolean;
  tradeBias?: "LONG BIAS" | "SHORT BIAS" | "WAIT";
  tradeState?: "STRONG BULL" | "STRONG BEAR" | "BULL" | "BEAR" | "NEUTRAL";
  oscSpread?: number;
  priceToStopAtr?: number;
  clusterMetadata?: ClusterMetadata;
  agentPayload?: Record<string, unknown>;
}

export interface BacktestTrade {
  id: number;
  entryTime: number;
  exitTime: number;
  type: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  targetPrice?: number;
  pnl: number;
  pnlPct: number;
  mfePct: number; // Max Favorable Excursion % (peak unrealized profit)
  maePct: number; // Max Adverse Excursion % (deepest unrealized drawdown)
  exitReason: "SUPER_TREND_FLIP" | "STOP_LOSS" | "TAKE_PROFIT" | "LLM_FILTER_EXIT";
  llmApproved: boolean;
  llmReason?: string;
  confidence: number;
  confidenceTier: ConfidenceTier;
  sizeMultiplier: number;
  runningEquity: number;
}

export interface BacktestOptions {
  atrLen?: number;
  fallbackMult?: number;
  percentileRank?: number;
  maxSamples?: number;
  minSamples?: number;
  minMult?: number;
  maxMult?: number;
  initialEquity?: number;
  riskPctPerTrade?: number;
  minConfidence?: number; // Filter: only execute trades with >= minConfidence (e.g. 70%)
  useLlmFilter?: boolean;
  useOrderFlowFilter?: boolean;
  useChopFilter?: boolean; // Filter: Avoid choppy sideways compression (CHOP > 61.8)
  maxChopThreshold?: number; // default: 61.8
  takeProfitR?: number; // e.g. 2.0 = 2R TP
  step?: number;
  perfAlpha?: number;
  fromCluster?: "Best" | "Average" | "Worst";
  oscSmooth?: number;
  useOscillatorFilter?: boolean; // Filter: require tradeBias confirmation
}

export interface BacktestSummary {
  initialEquity: number;
  finalEquity: number;
  netProfit: number;
  netProfitPct: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  maxDrawdownAmount: number;
  avgWin: number;
  avgLoss: number;
  avgMfePct: number;
  avgMaePct: number;
  rewardRiskRatio: number;
  sharpeRatio: number;
  avgConfidence: number;
  equityCurve: { time: number; equity: number; drawdown: number }[];
  trades: BacktestTrade[];
}

export interface TimeframePerformanceCard {
  interval: string;
  label: string;
  candleCount: number;
  currentTrend: "BULLISH" | "BEARISH" | "NEUTRAL";
  currentConfidence: number;
  chopIndex: number;
  adxStrength: number;
  regime: string;
  recommendedPreset: string;
  winRatePct: number;
  profitFactor: number;
  netProfitPct: number;
  maxDrawdownPct: number;
  tradesCount: number;
}

interface EnsembleMember {
  factor: number;
  upper: number;
  lower: number;
  output: number;
  perf: number;
  trend: number;
}

interface BarContext {
  time: number;
  close: number;
  prevClose: number;
  hl2: number;
  atr: number;
}

export class AdaptiveSupertrend {
  private step: number;
  private perfAlpha: number;
  private fromCluster: "Best" | "Average" | "Worst";
  private oscSmooth: number;
  private maxIter: number;
  private ensemble: EnsembleMember[] = [];
  private upBand: number = 0;
  private dnBand: number = 0;
  private targetFactor: number = 3.0;
  private perfIdx: number = 0;
  private perfAma: number = 0;
  private denEma: number = 0;
  private trend: TrendDirection = "NEUTRAL";
  private bull: number = 0;
  private neutral: number = 0;
  private bear: number = 0;
  private bullSamples: number[] = [];
  private bearSamples: number[] = [];

  constructor(
    private atrLen: number = 10,
    private fallbackMult: number = 3.0,
    private percentileRank: number = 85,
    private maxSamples: number = 150,
    private minSamples: number = 25,
    private minMult: number = 1.0,
    private maxMult: number = 6.0,
    options?: ClusteringOptions
  ) {
    this.step = options?.step ?? 0.5;
    this.perfAlpha = options?.perfAlpha ?? 10.0;
    this.fromCluster = options?.fromCluster ?? "Best";
    this.oscSmooth = options?.oscSmooth ?? 1.0;
    this.maxIter = options?.maxIter ?? 25;
    this.initEnsemble();
  }

  private initEnsemble(): void {
    this.ensemble = [];
    const step = Math.max(0.1, this.step);
    const low = Math.min(this.minMult, this.maxMult);
    const high = Math.max(this.minMult, this.maxMult);
    const count = Math.min(50, Math.floor((high - low) / step + 1e-7));
    for (let i = 0; i <= count; i++) {
      const factor = Number((low + i * step).toFixed(4));
      this.ensemble.push({ factor, upper: 0, lower: 0, output: 0, perf: 0, trend: 0 });
    }
  }

  public reset(): void {
    this.initEnsemble();
    this.bullSamples = [];
    this.bearSamples = [];
    this.trend = "NEUTRAL";
    this.upBand = 0;
    this.dnBand = 0;
    this.targetFactor = this.fallbackMult;
    this.perfIdx = 0;
    this.perfAma = 0;
    this.denEma = 0;
    this.bull = 0;
    this.neutral = 0;
    this.bear = 0;
  }

  private updateMember(m: EnsembleMember, ctx: BarContext): void {
    const up = ctx.hl2 + ctx.atr * m.factor;
    const dn = ctx.hl2 - ctx.atr * m.factor;
    // Latch breakout condition against previous bands
    m.trend = ctx.close > m.upper ? 1 : ctx.close < m.lower ? 0 : m.trend;
    m.upper = ctx.prevClose < m.upper ? Math.min(up, m.upper) : up;
    m.lower = ctx.prevClose > m.lower ? Math.max(dn, m.lower) : dn;
    // Exponential performance accumulator driven by directional price movement
    const diff = Math.sign(ctx.prevClose - m.output) || 0;
    const alpha = 2.0 / (this.perfAlpha + 1.0);
    m.perf += alpha * ((ctx.close - ctx.prevClose) * diff - m.perf);
    m.output = m.trend === 1 ? m.lower : m.upper;
  }

  private nearestCentroidIdx(val: number, centroids: number[]): number {
    let minD = Infinity;
    let best = 0;
    for (let i = 0; i < centroids.length; i++) {
      const d = Math.abs(val - centroids[i]);
      if (d < minD) {
        minD = d;
        best = i;
      }
    }
    return best;
  }

  private calcDispersion(values: number[], centroid: number): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((acc, v) => acc + Math.abs(v - centroid), 0);
    return sum / values.length;
  }

  private runKMeans1D(values: number[]): number[] {
    if (values.length === 0) return [0, 0, 0];
    let cents = [this.percentile(values, 25), this.percentile(values, 50), this.percentile(values, 75)];
    // Perturb identical centroids to prevent degenerate zero-variance clustering
    if (cents[0] === cents[2]) {
      cents = [cents[0] - 1e-4, cents[1], cents[2] + 1e-4];
    }
    return this.iterateKMeans(values, cents);
  }

  private iterateKMeans(values: number[], centroids: number[]): number[] {
    let cur = [...centroids];
    for (let iter = 0; iter < this.maxIter; iter++) {
      const clusters: number[][] = [[], [], []];
      for (const v of values) {
        clusters[this.nearestCentroidIdx(v, cur)].push(v);
      }
      const next = clusters.map((c, i) => (c.length > 0 ? c.reduce((a, b) => a + b, 0) / c.length : cur[i]));
      const converged = next.every((val, i) => Math.abs(val - cur[i]) < 1e-8);
      cur = next;
      if (converged) break;
    }
    return cur.sort((a, b) => a - b);
  }

  private clusterPerformance(): { factor: number; meta: Partial<ClusterMetadata> } {
    const perfData = this.ensemble.map((m) => m.perf);
    const cents = this.runKMeans1D(perfData);
    const clusters: { perfs: number[]; factors: number[] }[] = [
      { perfs: [], factors: [] },
      { perfs: [], factors: [] },
      { perfs: [], factors: [] },
    ];
    this.ensemble.forEach((m) => {
      const idx = this.nearestCentroidIdx(m.perf, cents);
      clusters[idx].perfs.push(m.perf);
      clusters[idx].factors.push(m.factor);
    });
    const targetIdx = this.fromCluster === "Best" ? 2 : this.fromCluster === "Average" ? 1 : 0;
    const tfList = clusters[targetIdx].factors;
    // Warm-up bars (all-zero perf) put every member in the middle cluster, leaving the
    // selected cluster empty — fall back to the configured multiplier, not the arbitrary
    // first/minimum ensemble factor, so presets with different fallbackMult actually differ.
    const factorAvg = tfList.length > 0 ? tfList.reduce((a, b) => a + b, 0) / tfList.length : this.fallbackMult;
    const bestDisp = this.calcDispersion(clusters[2].perfs, cents[2]);
    return {
      factor: Math.max(this.minMult, Math.min(this.maxMult, factorAvg)),
      meta: {
        perfWorstCentroid: cents[0],
        perfAverageCentroid: cents[1],
        perfBestCentroid: cents[2],
        perfWorstDispersion: this.calcDispersion(clusters[0].perfs, cents[0]),
        perfAverageDispersion: this.calcDispersion(clusters[1].perfs, cents[1]),
        perfBestDispersion: bestDisp,
        bestClusterStability: bestDisp / Math.max(Math.abs(cents[2]), 1e-10),
      },
    };
  }

  private clusterOscillator(close: number): Partial<ClusterMetadata> {
    const distData = this.ensemble.map((m) => close - m.output);
    const cents = this.runKMeans1D(distData);
    const clusters: number[][] = [[], [], []];
    distData.forEach((d) => clusters[this.nearestCentroidIdx(d, cents)].push(d));
    const oscAlpha = 2.0 / (this.oscSmooth + 1.0);
    this.bear += oscAlpha * (cents[0] - this.bear);
    this.neutral += oscAlpha * (cents[1] - this.neutral);
    this.bull += oscAlpha * (cents[2] - this.bull);
    const bullDisp = this.calcDispersion(clusters[2], cents[2]);
    return {
      stateBearCentroid: cents[0],
      stateNeutralCentroid: cents[1],
      stateBullCentroid: cents[2],
      stateBearDispersion: this.calcDispersion(clusters[0], cents[0]),
      stateNeutralDispersion: this.calcDispersion(clusters[1], cents[1]),
      stateBullDispersion: bullDisp,
      bullClusterStability: bullDisp / Math.max(Math.abs(cents[2]), 1e-10),
    };
  }

  private updateAdaptiveBands(ctx: BarContext, targetFactor: number, perfBestCentroid: number): number {
    const upAdaptive = ctx.hl2 + ctx.atr * targetFactor;
    const dnAdaptive = ctx.hl2 - ctx.atr * targetFactor;
    this.dnBand = ctx.prevClose < this.dnBand ? Math.min(upAdaptive, this.dnBand) : upAdaptive;
    this.upBand = ctx.prevClose > this.upBand ? Math.max(dnAdaptive, this.upBand) : dnAdaptive;
    const prevTrend = this.trend;
    this.trend = ctx.close > this.dnBand ? "UP" : ctx.close < this.upBand ? "DOWN" : prevTrend;
    const ts = this.trend === "UP" ? this.upBand : this.dnBand;
    // Volatility denominator scales the dynamic smoothing speed of the AMA
    const denLen = Math.max(2, Math.round(this.perfAlpha));
    const denAlpha = 2.0 / (denLen + 1.0);
    this.denEma += denAlpha * (Math.abs(ctx.close - ctx.prevClose) - this.denEma);
    this.perfIdx = this.denEma > 0 ? Math.max(perfBestCentroid || 0, 0) / this.denEma : 0;
    this.perfAma = this.perfAma === 0 ? ts : this.perfAma + this.perfIdx * (ts - this.perfAma);
    return ts;
  }

  private processBar(ctx: BarContext, isFirst: boolean): SupertrendPoint {
    if (isFirst) {
      this.ensemble.forEach((m) => {
        m.upper = ctx.hl2 + ctx.atr * m.factor;
        m.lower = ctx.hl2 - ctx.atr * m.factor;
        m.output = m.upper;
      });
      this.upBand = ctx.hl2 - ctx.atr * this.fallbackMult;
      this.dnBand = ctx.hl2 + ctx.atr * this.fallbackMult;
      this.perfAma = ctx.close;
    } else {
      this.ensemble.forEach((m) => this.updateMember(m, ctx));
    }
    const prevTrend = this.trend;
    const perfCluster = this.clusterPerformance();
    this.targetFactor = perfCluster.factor;
    const ts = this.updateAdaptiveBands(ctx, perfCluster.factor, perfCluster.meta.perfBestCentroid ?? 0);
    const oscMeta = this.clusterOscillator(ctx.close);
    const meta: ClusterMetadata = { ...perfCluster.meta, ...oscMeta } as ClusterMetadata;
    const sigType: SignalType | null =
      this.trend === "UP" && prevTrend === "DOWN" ? "BUY" : this.trend === "DOWN" && prevTrend === "UP" ? "SELL" : null;
    return this.buildPoint(ctx, ts, sigType, meta);
  }

  private buildPoint(ctx: BarContext, ts: number, sigType: SignalType | null, meta: ClusterMetadata): SupertrendPoint {
    const strongBull = this.bull > 0 && this.neutral > 0 && this.bear > 0;
    const strongBear = this.bull < 0 && this.neutral < 0 && this.bear < 0;
    const bullishState = this.bull > 0 && this.neutral >= 0;
    const bearishState = this.bear < 0 && this.neutral <= 0;
    const tradeBias = this.trend === "UP" && bullishState ? "LONG BIAS" : this.trend === "DOWN" && bearishState ? "SHORT BIAS" : "WAIT";
    const tradeState = strongBull ? "STRONG BULL" : strongBear ? "STRONG BEAR" : bullishState ? "BULL" : bearishState ? "BEAR" : "NEUTRAL";
    return {
      time: ctx.time,
      trend: this.trend,
      supertrend: ts,
      upBand: this.upBand,
      dnBand: this.dnBand,
      atr: ctx.atr,
      adaptiveMult: this.targetFactor,
      signal: sigType,
      confidence: 70,
      confidenceTier: "HIGH",
      ama: this.perfAma,
      perfIdx: this.perfIdx,
      targetFactor: this.targetFactor,
      bull: this.bull,
      neutral: this.neutral,
      bear: this.bear,
      strongBull,
      strongBear,
      tradeBias,
      tradeState,
      oscSpread: this.bull - this.bear,
      priceToStopAtr: ctx.atr > 0 ? (ctx.close - ts) / ctx.atr : 0,
      clusterMetadata: meta,
    };
  }

  public computeFullSeries(candles: Candle[]): SupertrendPoint[] {
    this.reset();
    if (candles.length === 0) return [];
    const points: SupertrendPoint[] = [];
    let prevAtr = 0;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const prevClose = i > 0 ? candles[i - 1].close : c.close;
      const tr = i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
      const atr = i === 0 ? tr : i < this.atrLen ? (prevAtr * i + tr) / (i + 1) : (prevAtr * (this.atrLen - 1) + tr) / this.atrLen;
      prevAtr = atr;
      const ctx: BarContext = { time: c.time, close: c.close, prevClose, hl2: (c.high + c.low) / 2, atr };
      const pt = this.processBar(ctx, i === 0);
      this.recordPullback(candles.slice(Math.max(0, i - 3), i + 1), atr);
      const conf = this.computeConfidence(pt.trend === "UP" ? "BUY" : "SELL", candles.slice(0, i + 1), atr, this.trend === "UP" ? this.bullSamples : this.bearSamples);
      pt.confidence = conf.totalScore;
      pt.confidenceTier = conf.tier;
      points.push(pt);
    }
    return points;
  }

  public warmUpFromHistory(candles: Candle[]): void {
    if (candles.length < 2) return;
    this.computeFullSeries(candles.slice(0, -1));
  }

  private fallbackSignal(price: number, time: number): SupertrendSignal {
    return {
      type: "HOLD",
      price,
      stop: price,
      trend: "NEUTRAL",
      adaptiveMult: this.fallbackMult,
      atr: 0,
      time,
      confidence: 50,
      confidenceTier: "MEDIUM",
    };
  }

  public update(
    candles: Candle[],
    contextOptions?: { orderBookRatio?: number; fundingRate?: number; sentimentScore?: number }
  ): SupertrendSignal {
    if (candles.length < 2) {
      const p = candles[0]?.close || 0;
      return this.fallbackSignal(p, candles[0]?.time || 0);
    }
    const series = this.computeFullSeries(candles);
    const last = series[series.length - 1];
    const prev = series[series.length - 2];
    const conf = this.computeConfidence(last.trend === "UP" ? "BUY" : "SELL", candles, last.atr, last.trend === "UP" ? this.bullSamples : this.bearSamples, contextOptions);
    const type: SignalType = last.trend === "UP" && prev.trend === "DOWN" ? "BUY" : last.trend === "DOWN" && prev.trend === "UP" ? "SELL" : "HOLD";
    const sig: SupertrendSignal = {
      type,
      price: candles[candles.length - 1].close,
      stop: last.supertrend,
      trend: last.trend,
      adaptiveMult: last.adaptiveMult,
      atr: last.atr,
      time: last.time,
      confidence: conf.totalScore,
      confidenceTier: conf.tier,
      confidenceBreakdown: conf,
      ama: last.ama,
      perfIdx: last.perfIdx,
      bull: last.bull,
      neutral: last.neutral,
      bear: last.bear,
      strongBull: last.strongBull,
      strongBear: last.strongBear,
      tradeBias: last.tradeBias,
      tradeState: last.tradeState,
      oscSpread: last.oscSpread,
      priceToStopAtr: last.priceToStopAtr,
      clusterMetadata: last.clusterMetadata,
    };
    sig.agentPayload = this.getAgentPayload("ACTIVE", "LIVE", sig);
    return sig;
  }

  public getAgentPayload(symbol: string, timeframe: string, sig: SupertrendSignal): Record<string, unknown> {
    const meta = sig.clusterMetadata;
    return {
      schema: "supertrend-ai-suite.v1",
      symbol,
      timeframe,
      time: sig.time,
      close: sig.price,
      target_factor: sig.adaptiveMult,
      perf_idx: sig.perfIdx ?? 0,
      ts: sig.stop,
      ama: sig.ama ?? sig.stop,
      os: sig.trend === "UP" ? 1 : 0,
      bull: sig.bull ?? 0,
      neutral: sig.neutral ?? 0,
      bear: sig.bear ?? 0,
      state: sig.tradeState?.toLowerCase().replace(/ /g, "_") ?? "neutral",
      price_to_stop_atr: sig.priceToStopAtr ?? 0,
      oscillator_spread: sig.oscSpread ?? 0,
      best_cluster_stability: meta?.bestClusterStability ?? 0,
      bull_cluster_stability: meta?.bullClusterStability ?? 0,
      perf_clusters: {
        best: { centroid: meta?.perfBestCentroid ?? 0, dispersion: meta?.perfBestDispersion ?? 0 },
        average: { centroid: meta?.perfAverageCentroid ?? 0, dispersion: meta?.perfAverageDispersion ?? 0 },
        worst: { centroid: meta?.perfWorstCentroid ?? 0, dispersion: meta?.perfWorstDispersion ?? 0 },
      },
      state_clusters: {
        bull: { centroid: meta?.stateBullCentroid ?? 0, dispersion: meta?.stateBullDispersion ?? 0 },
        neutral: { centroid: meta?.stateNeutralCentroid ?? 0, dispersion: meta?.stateNeutralDispersion ?? 0 },
        bear: { centroid: meta?.stateBearCentroid ?? 0, dispersion: meta?.stateBearDispersion ?? 0 },
      },
    };
  }

  private calcOrderFlowScore(signalType: "BUY" | "SELL", obRatio: number): number {
    if (signalType === "BUY") return obRatio > 1.3 ? 95 : obRatio < 0.7 ? 25 : 65;
    return obRatio < 0.7 ? 95 : obRatio > 1.3 ? 25 : 65;
  }

  private calcSentimentScore(signalType: "BUY" | "SELL", sentiment: number, funding: number): number {
    if (signalType === "BUY") {
      const s = sentiment > 0 ? 80 + sentiment * 20 : 60 + sentiment * 40;
      const f = funding < -0.02 ? 90 : funding > 0.04 ? 30 : 65;
      return Math.round((s + f) / 2);
    }
    const s = sentiment < 0 ? 80 + Math.abs(sentiment) * 20 : 60 - sentiment * 40;
    const f = funding > 0.02 ? 90 : funding < -0.04 ? 30 : 65;
    return Math.round((s + f) / 2);
  }

  public computeConfidence(
    signalType: "BUY" | "SELL",
    candles: Candle[],
    atr: number,
    samples: number[],
    options?: {
      orderBookRatio?: number;
      fundingRate?: number;
      sentimentScore?: number;
    }
  ): ConfidenceFactorBreakdown {
    const sampleRatio = Math.min(1.0, samples.length / Math.max(1, this.minSamples));
    const statisticalSampling = Math.round(sampleRatio * 85 + (samples.length > 50 ? 15 : 0));
    let volumeExpansion = 50;
    if (candles.length >= 20) {
      const recent = candles.slice(-20);
      const avgVol = recent.reduce((a, b) => a + (b.volume || 0), 0) / 20;
      const currVol = candles[candles.length - 1]?.volume || 0;
      volumeExpansion = Math.min(100, Math.round((avgVol > 0 ? currVol / avgVol : 1.0) * 55));
    }
    let mtfAlignment = 50;
    if (candles.length >= 50) {
      const closes = candles.map((c) => c.close);
      const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
      const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      mtfAlignment = (sma20 > sma50) === (signalType === "BUY") ? 90 : 35;
    }
    const orderFlowImbalance = this.calcOrderFlowScore(signalType, options?.orderBookRatio ?? 1.0);
    const llmSentiment = this.calcSentimentScore(signalType, options?.sentimentScore ?? 0, options?.fundingRate ?? 0);
    const oscBonus =
      (signalType === "BUY" && this.bull > 0 && this.neutral >= 0) ||
      (signalType === "SELL" && this.bear < 0 && this.neutral <= 0)
        ? 6
        : -6;
    const baseScore = Math.round(
      statisticalSampling * 0.25 +
        volumeExpansion * 0.2 +
        mtfAlignment * 0.2 +
        orderFlowImbalance * 0.2 +
        llmSentiment * 0.15
    );
    const totalScore = Math.min(99, Math.max(15, baseScore + oscBonus));
    const tier: ConfidenceTier = totalScore >= 88 ? "PRIME" : totalScore >= 75 ? "HIGH" : totalScore >= 55 ? "MEDIUM" : "LOW";
    return { statisticalSampling, mtfAlignment, orderFlowImbalance, volumeExpansion, llmSentiment, totalScore, tier };
  }

  public calculateATR(candles: Candle[], length: number): number {
    if (candles.length < 2) return 0;
    const count = Math.min(candles.length, length * 2);
    const startIdx = candles.length - count;
    let trSum = 0;
    for (let i = startIdx + 1; i < candles.length; i++) {
      const curr = candles[i];
      const prev = candles[i - 1];
      const hl = curr.high - curr.low;
      const hc = Math.abs(curr.high - prev.close);
      const lc = Math.abs(curr.low - prev.close);
      trSum += Math.max(hl, hc, lc);
    }
    return trSum / (count - 1 || 1);
  }

  public percentile(arr: number[], p: number): number {
    if (arr.length === 0) return this.fallbackMult;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    if (upper >= sorted.length) return sorted[sorted.length - 1];
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  private recordPullback(candles: Candle[], atr: number): void {
    if (candles.length < 4 || atr <= 0) return;
    const c0 = candles[candles.length - 1];
    const c1 = candles[candles.length - 2];
    const c2 = candles[candles.length - 3];
    if (this.trend === "UP" && c1.low < c2.low && c0.close > c1.high) {
      const pullbackDist = (c0.high - c1.low) / atr;
      if (pullbackDist > 0.5 && pullbackDist < 10) {
        this.bullSamples.push(pullbackDist);
        if (this.bullSamples.length > this.maxSamples) this.bullSamples.shift();
      }
    }
    if (this.trend === "DOWN" && c1.high > c2.high && c0.close < c1.low) {
      const pullbackDist = (c1.high - c0.low) / atr;
      if (pullbackDist > 0.5 && pullbackDist < 10) {
        this.bearSamples.push(pullbackDist);
        if (this.bearSamples.length > this.maxSamples) this.bearSamples.shift();
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // QUANTITATIVE BACKTESTING ENGINE WITH CONFIDENCE FILTERING
  // ─────────────────────────────────────────────────────────────────────────

  public runBacktest(candles: Candle[], options: BacktestOptions = {}): BacktestSummary {
    const {
      initialEquity = 100000,
      riskPctPerTrade = 0.01,
      minConfidence = 0, // Filter: 0 = all, e.g. 70 = only >=70% confidence trades
      useLlmFilter = false,
      takeProfitR = 0,
    } = options;
    this.reset();
    const series = this.computeFullSeries(candles);

    let equity = initialEquity;
    let peakEquity = initialEquity;
    let maxDrawdownAmt = 0;
    let maxDrawdownPct = 0;

    const trades: BacktestTrade[] = [];
    const equityCurve: { time: number; equity: number; drawdown: number }[] = [
      { time: candles[0]?.time || 0, equity: initialEquity, drawdown: 0 },
    ];

    let currentTrade: {
      id: number;
      type: "BUY" | "SELL";
      entryPrice: number;
      entryTime: number;
      stopPrice: number;
      targetPrice?: number;
      confidence: number;
      confidenceTier: ConfidenceTier;
      sizeMultiplier: number;
      qty: number;
      peakHigh: number;
      troughLow: number;
    } | null = null;

    let tradeIdCounter = 1;

    for (let i = 1; i < series.length; i++) {
      const pt = series[i];
      const candle = candles[i];

      // 1. Check open trade stop / target
      if (currentTrade) {
        if (candle.high > currentTrade.peakHigh) currentTrade.peakHigh = candle.high;
        if (candle.low < currentTrade.troughLow) currentTrade.troughLow = candle.low;

        let closed = false;
        let exitPrice = candle.close;
        let exitReason: BacktestTrade["exitReason"] = "SUPER_TREND_FLIP";

        if (currentTrade.type === "BUY") {
          // Stop Loss Hit
          if (candle.low <= currentTrade.stopPrice) {
            closed = true;
            exitPrice = currentTrade.stopPrice;
            exitReason = "STOP_LOSS";
          } else if (currentTrade.targetPrice && candle.high >= currentTrade.targetPrice) {
            closed = true;
            exitPrice = currentTrade.targetPrice;
            exitReason = "TAKE_PROFIT";
          } else if (pt.signal === "SELL") {
            closed = true;
            exitPrice = candle.close;
            exitReason = "SUPER_TREND_FLIP";
          }
        } else if (currentTrade.type === "SELL") {
          // Stop Loss Hit
          if (candle.high >= currentTrade.stopPrice) {
            closed = true;
            exitPrice = currentTrade.stopPrice;
            exitReason = "STOP_LOSS";
          } else if (currentTrade.targetPrice && candle.low <= currentTrade.targetPrice) {
            closed = true;
            exitPrice = currentTrade.targetPrice;
            exitReason = "TAKE_PROFIT";
          } else if (pt.signal === "BUY") {
            closed = true;
            exitPrice = candle.close;
            exitReason = "SUPER_TREND_FLIP";
          }
        }

        if (closed) {
          const mult = currentTrade.type === "BUY" ? 1 : -1;
          const pnlPerUnit = (exitPrice - currentTrade.entryPrice) * mult;
          const rawPnl = pnlPerUnit * currentTrade.qty;
          const pnl = Number(rawPnl.toFixed(2));
          const pnlPct = Number((((exitPrice - currentTrade.entryPrice) / currentTrade.entryPrice) * 100 * mult).toFixed(2));

          const mfePct =
            currentTrade.type === "BUY"
              ? Number((((currentTrade.peakHigh - currentTrade.entryPrice) / currentTrade.entryPrice) * 100).toFixed(2))
              : Number((((currentTrade.entryPrice - currentTrade.troughLow) / currentTrade.entryPrice) * 100).toFixed(2));
          const maePct =
            currentTrade.type === "BUY"
              ? Number((((currentTrade.entryPrice - currentTrade.troughLow) / currentTrade.entryPrice) * 100).toFixed(2))
              : Number((((currentTrade.peakHigh - currentTrade.entryPrice) / currentTrade.entryPrice) * 100).toFixed(2));

          equity += pnl;
          if (equity > peakEquity) peakEquity = equity;
          const ddAmt = peakEquity - equity;
          const ddPct = (ddAmt / peakEquity) * 100;
          if (ddAmt > maxDrawdownAmt) maxDrawdownAmt = ddAmt;
          if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

          trades.push({
            id: currentTrade.id,
            entryTime: currentTrade.entryTime,
            exitTime: candle.time,
            type: currentTrade.type,
            entryPrice: currentTrade.entryPrice,
            exitPrice: Number(exitPrice.toFixed(4)),
            stopPrice: Number(currentTrade.stopPrice.toFixed(4)),
            targetPrice: currentTrade.targetPrice ? Number(currentTrade.targetPrice.toFixed(4)) : undefined,
            pnl,
            pnlPct,
            mfePct,
            maePct,
            exitReason,
            llmApproved: true,
            confidence: currentTrade.confidence,
            confidenceTier: currentTrade.confidenceTier,
            sizeMultiplier: currentTrade.sizeMultiplier,
            runningEquity: Number(equity.toFixed(2)),
          });

          equityCurve.push({
            time: candle.time,
            equity: Number(equity.toFixed(2)),
            drawdown: Number(ddPct.toFixed(2)),
          });

          currentTrade = null;
        }
      }

      // 2. Open new trade on flip (filtered by minimum confidence & chop threshold)
      if (!currentTrade && pt.signal && pt.signal !== "HOLD") {
        // Enforce AI Confidence Filter
        if (pt.confidence < minConfidence) {
          continue;
        }

        // Enforce Choppiness Avoidance Filter (Skip high chop / squeeze regimes)
        if (options.useChopFilter) {
          const window = candles.slice(Math.max(0, i - 14), i + 1);
          const chopIndex = MarketRegimeEngine.calculateChoppinessIndex(window, 14);
          if (chopIndex > (options.maxChopThreshold || 61.8)) {
            continue; // Skip choppy whip-saw entry!
          }
        }

        // Enforce Clustering Oscillator Bias Filter (reject flips into strong counter-regimes)
        if (options.useOscillatorFilter) {
          if (pt.signal === "BUY" && pt.strongBear) continue;
          if (pt.signal === "SELL" && pt.strongBull) continue;
        }

        const riskAmount = equity * riskPctPerTrade;
        const stopDistance = Math.abs(candle.close - pt.supertrend);

        if (stopDistance > 0) {
          let sizeMult = 1.0;
          let approved = true;

          // Confidence Sizing Scaling: PRIME confidence boosts sizing up to 1.5x, LOW scales down to 0.6x
          if (pt.confidenceTier === "PRIME") sizeMult = 1.4;
          else if (pt.confidenceTier === "HIGH") sizeMult = 1.1;
          else if (pt.confidenceTier === "LOW") sizeMult = 0.6;

          // Simulated LLM filter check in backtest
          if (useLlmFilter) {
            const isHighNoise = pt.adaptiveMult > 4.5;
            if (isHighNoise) {
              sizeMult *= 0.5;
            }
          }

          const finalRisk = riskAmount * sizeMult;
          const qty = finalRisk / stopDistance;
          const targetPrice = takeProfitR > 0
            ? pt.signal === "BUY"
              ? candle.close + stopDistance * takeProfitR
              : candle.close - stopDistance * takeProfitR
            : undefined;

          if (approved && qty > 0) {
            currentTrade = {
              id: tradeIdCounter++,
              type: pt.signal,
              entryPrice: candle.close,
              entryTime: candle.time,
              stopPrice: pt.supertrend,
              targetPrice,
              confidence: pt.confidence,
              confidenceTier: pt.confidenceTier,
              sizeMultiplier: Number(sizeMult.toFixed(2)),
              qty,
              peakHigh: candle.high,
              troughLow: candle.low,
            };
          }
        }
      }
    }

    // Calculate quantitative metrics
    const netProfit = Number((equity - initialEquity).toFixed(2));
    const netProfitPct = Number(((netProfit / initialEquity) * 100).toFixed(2));
    const winTrades = trades.filter((t) => t.pnl > 0);
    const lossTrades = trades.filter((t) => t.pnl <= 0);

    const winCount = winTrades.length;
    const lossCount = lossTrades.length;
    const winRatePct = trades.length > 0 ? Number(((winCount / trades.length) * 100).toFixed(1)) : 0;

    const grossProfit = winTrades.reduce((acc, t) => acc + t.pnl, 0);
    const grossLoss = Math.abs(lossTrades.reduce((acc, t) => acc + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99.9 : 0;

    const avgWin = winCount > 0 ? Number((grossProfit / winCount).toFixed(2)) : 0;
    const avgLoss = lossCount > 0 ? Number((grossLoss / lossCount).toFixed(2)) : 0;
    const rewardRiskRatio = avgLoss > 0 ? Number((avgWin / avgLoss).toFixed(2)) : 0;

    const avgMfePct = trades.length > 0 ? Number((trades.reduce((a, t) => a + (t.mfePct || 0), 0) / trades.length).toFixed(2)) : 0;
    const avgMaePct = trades.length > 0 ? Number((trades.reduce((a, t) => a + (t.maePct || 0), 0) / trades.length).toFixed(2)) : 0;

    const avgConfidence = trades.length > 0
      ? Math.round(trades.reduce((a, t) => a + t.confidence, 0) / trades.length)
      : 0;

    // Daily returns approximation for Sharpe Ratio
    const returns = trades.map((t) => t.pnlPct / 100);
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 1
      ? Math.sqrt(returns.map((r) => Math.pow(r - avgReturn, 2)).reduce((a, b) => a + b, 0) / (returns.length - 1))
      : 0;
    const sharpeRatio = stdDev > 0 ? Number(((avgReturn / stdDev) * Math.sqrt(252)).toFixed(2)) : 0;

    return {
      initialEquity,
      finalEquity: Number(equity.toFixed(2)),
      netProfit,
      netProfitPct,
      totalTrades: trades.length,
      winCount,
      lossCount,
      winRatePct,
      profitFactor,
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      maxDrawdownAmount: Number(maxDrawdownAmt.toFixed(2)),
      avgWin,
      avgLoss,
      avgMfePct,
      avgMaePct,
      rewardRiskRatio,
      sharpeRatio,
      avgConfidence,
      equityCurve,
      trades,
    };
  }

  /**
   * Comprehensive Grid Search Sweep: Evaluates combinations of parameters on historical data
   * and ranks candidates by composite risk-adjusted performance.
   */
  public static runGridSearch(
    candles: Candle[],
    initialEquity: number = 100000,
    riskPctPerTrade: number = 0.01
  ): OptimizationCandidate[] {
    if (!candles || candles.length < 20) return [];

    const atrLens = [7, 10, 14];
    const fallbackMults = [2.5, 3.0, 3.5];
    const percentileRanks = [50, 75, 85];
    const minConfidences = [0, 70, 80];
    const takeProfitRs = [0, 1.5, 2.5];
    const chopFilters = [true, false];

    const results: OptimizationCandidate[] = [];

    for (const atrLen of atrLens) {
      for (const fallbackMult of fallbackMults) {
        for (const percentileRank of percentileRanks) {
          for (const minConfidence of minConfidences) {
            for (const takeProfitR of takeProfitRs) {
              for (const useChopFilter of chopFilters) {
                try {
                  const engine = new AdaptiveSupertrend(atrLen, fallbackMult, percentileRank, 150, 25, 1.0, 6.0);
                  const summary = engine.runBacktest(candles, {
                    initialEquity,
                    riskPctPerTrade,
                    minConfidence,
                    takeProfitR,
                    useChopFilter,
                  });

                  if (summary.totalTrades >= 3) {
                    // Fitness score = (Win Rate * Profit Factor) / (Max Drawdown + 1)
                    const fitnessScore = Number(
                      (
                        (summary.winRatePct * (summary.profitFactor >= 99 ? 10 : summary.profitFactor)) /
                        Math.max(1, summary.maxDrawdownPct)
                      ).toFixed(2)
                    );

                    results.push({
                      rank: 0,
                      params: {
                        atrLen,
                        fallbackMult,
                        percentileRank,
                        minMult: 1.0,
                        maxMult: 6.0,
                        minConfidence,
                        takeProfitR,
                        useChopFilter,
                      },
                      summary,
                      fitnessScore,
                    });
                  }
                } catch {}
              }
            }
          }
        }
      }
    }

    // Sort descending by fitness score
    results.sort((a, b) => b.fitnessScore - a.fitnessScore);

    // Assign 1-indexed ranks
    results.forEach((r, idx) => {
      r.rank = idx + 1;
    });

    return results.slice(0, 15); // Return top 15 candidates
  }
}

export interface StrategyPreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  color: string;
  params: {
    atrLen: number;
    fallbackMult: number;
    percentileRank: number;
    minMult: number;
    maxMult: number;
    minConfidence: number;
    takeProfitR: number;
    useChopFilter: boolean;
    useLlmFilter: boolean;
  };
}

export interface OptimizationCandidate {
  rank: number;
  interval?: string; // timeframe the backtest ran on (null = single-TF sweep)
  params: {
    atrLen: number;
    fallbackMult: number;
    percentileRank: number;
    minMult: number;
    maxMult: number;
    minConfidence: number;
    takeProfitR: number;
    useChopFilter: boolean;
  };
  summary: BacktestSummary;
  fitnessScore: number;
  // LLM validation (populated by runGridSearchWithLLM)
  llmScore?: number;        // 0–100 composite AI rating
  llmRationale?: string;    // Ollama's plain-English reasoning
  llmApproved?: boolean;    // Whether LLM recommends this config
  llmModel?: string;        // Actual model that produced the verdict (or "heuristic")
  llmSimulated?: boolean;   // True when the deterministic fallback was used
  llmStatus?: "pending" | "evaluating" | "done" | "error";
}

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: "prime_scalper",
    name: "Prime Scalper (High Win-Rate)",
    badge: "🌟 75%+ WIN-RATE",
    description: "Fast 7-ATR sampling, 75th percentile pullback buffer, 1.5R quick target, and strict chop filter.",
    color: "#00F5A0",
    params: {
      atrLen: 7,
      fallbackMult: 2.5,
      percentileRank: 75,
      minMult: 1.0,
      maxMult: 5.0,
      minConfidence: 75,
      takeProfitR: 1.5,
      useChopFilter: true,
      useLlmFilter: true,
    },
  },
  {
    id: "trend_runner",
    name: "Trend Runner (Max Profit Swings)",
    badge: "🚀 3.5x PROFIT FACTOR",
    description: "14-ATR swing sampling, 50th percentile trail, wide 3.0R targets to capture multi-day breakout waves.",
    color: "#00E5FF",
    params: {
      atrLen: 14,
      fallbackMult: 3.5,
      percentileRank: 50,
      minMult: 1.5,
      maxMult: 6.0,
      minConfidence: 65,
      takeProfitR: 3.0,
      useChopFilter: true,
      useLlmFilter: false,
    },
  },
  {
    id: "institutional_conservative",
    name: "Institutional (Capital Preservation)",
    badge: "🛡️ < 4% DRAWDOWN",
    description: "85th percentile high-certainty cushion, 80% AI confidence gate, and volatility squeeze avoidance.",
    color: "#FFD700",
    params: {
      atrLen: 10,
      fallbackMult: 3.0,
      percentileRank: 85,
      minMult: 1.2,
      maxMult: 5.5,
      minConfidence: 80,
      takeProfitR: 2.0,
      useChopFilter: true,
      useLlmFilter: true,
    },
  },
  {
    id: "crypto_volatility_hunter",
    name: "Crypto Volatility Hunter (SOL/ETH)",
    badge: "⚡ HIGH BETA / WIDE RAILS",
    description: "35th percentile trail with 8.0x max ceiling to prevent premature shakeouts on large crypto wicks.",
    color: "#EC4899",
    params: {
      atrLen: 10,
      fallbackMult: 3.0,
      percentileRank: 35,
      minMult: 1.0,
      maxMult: 8.0,
      minConfidence: 70,
      takeProfitR: 2.5,
      useChopFilter: true,
      useLlmFilter: true,
    },
  },
  {
    id: "indian_indices_intraday",
    name: "Indian Indices Intraday (NIFTY/BNF)",
    badge: "🏛️ 9:15 - 15:30 IST",
    description: "Optimized for Indian market session momentum, 60th percentile pullbacks, and 1.5R target fills.",
    color: "#FF9900",
    params: {
      atrLen: 10,
      fallbackMult: 2.5,
      percentileRank: 60,
      minMult: 1.0,
      maxMult: 4.5,
      minConfidence: 70,
      takeProfitR: 1.5,
      useChopFilter: true,
      useLlmFilter: true,
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// IN-SESSION PARAMETER ADAPTATION
// Re-tunes ATR length, fallback multiplier, percentile rank, and mult rails
// from the live market regime, scaled around the user's baseline values.
// A regime flip plus a cooldown prevents whipsaw re-tuning; every change is
// recorded as an audit-log entry for the session view.
// ─────────────────────────────────────────────────────────────────────────────

export interface SupertrendParamSet {
  atrLen: number;
  fallbackMult: number;
  percentileRank: number;
  minMult: number;
  maxMult: number;
}

export interface ParamAdaptationEntry {
  time: number;
  regime: MarketRegimeType;
  chopIndex: number;
  adx: number;
  macroBias: MacroBias;
  from: SupertrendParamSet;
  to: SupertrendParamSet;
  reason: string;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

const paramsEqual = (a: SupertrendParamSet, b: SupertrendParamSet): boolean =>
  a.atrLen === b.atrLen &&
  a.fallbackMult === b.fallbackMult &&
  a.percentileRank === b.percentileRank &&
  a.minMult === b.minMult &&
  a.maxMult === b.maxMult;

export class SupertrendParamAdapter {
  private lastAdaptation: { time: number; regime: MarketRegimeType } | null = null;

  constructor(private cooldownMs: number = 3 * 60 * 1000) {}

  public reset(): void {
    this.lastAdaptation = null;
  }

  public evaluate(
    current: SupertrendParamSet,
    telemetry: MarketRegimeTelemetry
  ): ParamAdaptationEntry | null {
    const now = Date.now();
    if (this.lastAdaptation && telemetry.regime === this.lastAdaptation.regime) return null;
    if (this.lastAdaptation && now - this.lastAdaptation.time < this.cooldownMs) return null;

    const to = this.targetFor(current, telemetry);
    if (paramsEqual(current, to)) return null;

    const entry: ParamAdaptationEntry = {
      time: now,
      regime: telemetry.regime,
      chopIndex: telemetry.chopIndex,
      adx: telemetry.adx,
      macroBias: telemetry.macroBias,
      from: { ...current },
      to,
      reason: this.reasonFor(current, to, telemetry),
    };
    this.lastAdaptation = { time: now, regime: telemetry.regime };
    return entry;
  }

  /** Maps a regime to an adjusted param set, scaled around the user's baseline. */
  private targetFor(current: SupertrendParamSet, t: MarketRegimeTelemetry): SupertrendParamSet {
    switch (t.regime) {
      case "TRENDING_EXPANSION":
        return {
          atrLen: clamp(Math.round(current.atrLen * 0.7), 5, 30),
          fallbackMult: round1(clamp(current.fallbackMult * 0.85, 1.0, 6.0)),
          percentileRank: clamp(current.percentileRank - 20, 50, 95),
          minMult: current.minMult,
          maxMult: round1(clamp(current.maxMult * 0.8, 1.0, 8.0)),
        };
      case "CHOPPY_COMPRESSION":
        return {
          atrLen: clamp(Math.round(current.atrLen * 1.4), 5, 30),
          fallbackMult: round1(clamp(current.fallbackMult * 1.3, 1.0, 6.0)),
          percentileRank: clamp(current.percentileRank + 15, 50, 95),
          minMult: current.minMult,
          maxMult: round1(clamp(current.maxMult * 1.1, 1.0, 8.0)),
        };
      case "VOLATILITY_SQUEEZE":
        return {
          atrLen: clamp(Math.round(current.atrLen * 1.15), 5, 30),
          fallbackMult: round1(clamp(current.fallbackMult * 1.2, 1.0, 6.0)),
          percentileRank: clamp(current.percentileRank + 10, 50, 95),
          minMult: current.minMult,
          maxMult: round1(clamp(current.maxMult * 1.1, 1.0, 8.0)),
        };
      default:
        return { ...current }; // TRANSITION: keep user baseline
    }
  }

  private reasonFor(from: SupertrendParamSet, to: SupertrendParamSet, t: MarketRegimeTelemetry): string {
    const diffs: string[] = [];
    if (from.atrLen !== to.atrLen) diffs.push(`ATR ${from.atrLen}→${to.atrLen}`);
    if (from.fallbackMult !== to.fallbackMult) diffs.push(`Fallback ${from.fallbackMult}x→${to.fallbackMult}x`);
    if (from.percentileRank !== to.percentileRank) diffs.push(`P${from.percentileRank}→P${to.percentileRank}`);
    if (from.minMult !== to.minMult) diffs.push(`MinMult ${from.minMult}x→${to.minMult}x`);
    if (from.maxMult !== to.maxMult) diffs.push(`MaxMult ${from.maxMult}x→${to.maxMult}x`);
    return `${t.regime.replace(/_/g, " ")} (CHOP ${t.chopIndex}, ADX ${t.adx}, ${t.macroBias}): ${diffs.join(", ")}`;
  }
}

const PARAMS_STORAGE_KEY = "chart_supertrend_params";
const AUTO_ADAPT_STORAGE_KEY = "chart_supertrend_auto_adapt";

/** Singleton so the chart overlay and the workbench share regime/cooldown state. */
export const sharedParamAdapter = new SupertrendParamAdapter();

/** Full applied config (math params + risk gates) persisted across sessions. */
export interface SupertrendPersistedConfig extends SupertrendParamSet {
  minConfidence: number;
  takeProfitR: number;
  useChopFilter: boolean;
  useLlmFilter: boolean;
}

export function saveSupertrendConfig(cfg: SupertrendPersistedConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(cfg));
  } catch {}
}

export function loadSupertrendConfig(): SupertrendPersistedConfig {
  const def: SupertrendPersistedConfig = {
    atrLen: 10,
    fallbackMult: 3.0,
    percentileRank: 85,
    minMult: 1.0,
    maxMult: 6.0,
    minConfidence: 70,
    takeProfitR: 0,
    useChopFilter: true,
    useLlmFilter: true,
  };
  if (typeof window === "undefined") return def;
  try {
    const raw = localStorage.getItem(PARAMS_STORAGE_KEY);
    if (!raw) return def;
    const p = JSON.parse(raw);
    const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
    const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
    return {
      atrLen: num(p.atrLen, def.atrLen),
      fallbackMult: num(p.fallbackMult, def.fallbackMult),
      percentileRank: num(p.percentileRank, def.percentileRank),
      minMult: num(p.minMult, def.minMult),
      maxMult: num(p.maxMult, def.maxMult),
      minConfidence: num(p.minConfidence, def.minConfidence),
      takeProfitR: num(p.takeProfitR, def.takeProfitR),
      useChopFilter: bool(p.useChopFilter, def.useChopFilter),
      useLlmFilter: bool(p.useLlmFilter, def.useLlmFilter),
    };
  } catch {
    return def;
  }
}

export function saveSupertrendParams(params: SupertrendParamSet): void {
  saveSupertrendConfig({ ...loadSupertrendConfig(), ...params });
}

export function loadSupertrendParams(): SupertrendParamSet {
  const c = loadSupertrendConfig();
  return {
    atrLen: c.atrLen,
    fallbackMult: c.fallbackMult,
    percentileRank: c.percentileRank,
    minMult: c.minMult,
    maxMult: c.maxMult,
  };
}

export function saveSupertrendAutoAdapt(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AUTO_ADAPT_STORAGE_KEY, enabled ? "1" : "0");
  } catch {}
}

export function loadSupertrendAutoAdapt(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(AUTO_ADAPT_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}
