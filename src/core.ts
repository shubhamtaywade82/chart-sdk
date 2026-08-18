// ── Adapters & Types ──────────────────────────────────────────────────────────
export * from "./adapters/IDataAdapter";
export { BinanceAdapter } from "./adapters/BinanceAdapter";
export { DhanHQAdapter } from "./adapters/DhanHQAdapter";
export { CoindcxAdapter } from "./adapters/CoindcxAdapter";

// ── Explicit Shared Type ─────────────────────────────────────────────────────
export type { CandleData } from "./utils/smcEngine";

// ── Analysis & Indicator Engines (Pure Deterministic Math) ────────────────────
export {
  detectFVGs,
  detectOrderBlocks,
  detectMarketStructure,
  detectLiquidityPools,
  detectPremiumDiscount,
  detectSupplyDemandZones,
  detectTrendlineLiquidity,
  detectCandlestickPatterns,
  detectVolumeProfile,
  type FVGPattern,
  type OrderBlockPattern,
  type MarketStructureBreak,
  type LiquidityPoolPattern,
  type PremiumDiscountRange,
  type SupplyDemandZone,
  type TrendlineLiquidity,
  type CandlestickPattern,
  type CandlestickPatternType,
  type VolumeProfileResult,
} from "./utils/smcEngine";

export {
  detectICTSessions,
  detectSilverBulletWindows,
  detectICTOTEZone,
  detectJudasSwings,
  detectAMDCycles,
  type ICTSession,
  type ICTSilverBulletWindow,
  type ICTOTEZone,
  type ICTJudasSwing,
  type ICTAMDCycle,
} from "./utils/ictEngine";

export * from "./utils/adaptiveSupertrend";
export * from "./utils/autoTuningADX";
export * from "./utils/setupScanner";
export * from "./utils/paperTrader";
export * from "./utils/marketRegimeEngine";
export * from "./utils/marketDataConsensus";
export * from "./utils/riftEngine";
export * from "./utils/riftPaper";
export * from "./utils/riftSignals";
export * from "./utils/confluenceBacktestEngine";
export * from "./utils/ollamaContextEngine";

// ── Scripting Runtime & Sandbox ──────────────────────────────────────────────
export * from "./scripting/types";
export { executeScript } from "./scripting/scriptSandbox";
export * from "./scripting/backtestEngine";
export * from "./scripting/pineTranspiler";
export * from "./scripting/scriptStorage";
export * from "./scripting/taMath";
