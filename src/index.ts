"use client";

// ── Adapters & Types ──────────────────────────────────────────────────────────
export * from "./adapters/IDataAdapter";
export { BinanceAdapter } from "./adapters/BinanceAdapter";
export { DhanHQAdapter } from "./adapters/DhanHQAdapter";
export { CoindcxAdapter } from "./adapters/CoindcxAdapter";

// ── Components ───────────────────────────────────────────────────────────────
export {
  TradingViewChart,
  type ChartProps,
  type ChartScaleSettings,
  type DefaultScaleMode,
  type IndicatorMeta,
  type IndicatorSetDef,
  getPricePrecision,
  formatPriceDynamic,
} from "./components/TradingViewChart";
export { MarketDepthStream } from "./components/MarketDepthStream";
export { ADXLiveTuner, ADX_THEMES, type ADXTheme } from "./components/ADXLiveTuner";
export { AuthCredentialsModal } from "./components/AuthCredentialsModal";
export { ExecutionControlBar } from "./components/ExecutionControlBar";
export { ExpiredOptionsTable } from "./components/ExpiredOptionsTable";
export { OptDeskExpiryArchivePage } from "./components/OptDeskExpiryArchivePage";
export { RiftDashboard } from "./components/RiftDashboard";
export { SmcOverlayPrimitive } from "./components/SmcOverlayPrimitive";
export { Market3DView, type Market3DProps, type Timeframe3D, type Candle3D, type MarketStats } from "./components/Market3DView";
export { Market2DView } from "./components/Market2DView";

// ── Research Workbenches ─────────────────────────────────────────────────────
export { FuturesBacktestWorkbench } from "./components/research/FuturesBacktestWorkbench";
export { ConfluenceBacktestWorkbench } from "./components/research/ConfluenceBacktestWorkbench";
export { PositioningAnalyticsView } from "./components/research/PositioningAnalyticsView";
export { AdaptiveSupertrendWorkbench } from "./components/research/AdaptiveSupertrendWorkbench";
export { OptionsResearchWorkbench } from "./components/research_dhanhq/OptionsResearchWorkbench";

// ── Scripting & Backtesting UI ───────────────────────────────────────────────
export { ScriptEditorModal } from "./components/scripting/ScriptEditorModal";
export { ScriptLibraryModal } from "./components/scripting/ScriptLibraryModal";
export { BacktestResultsPanel } from "./components/scripting/BacktestResultsPanel";

// ── Explicit Shared Type ─────────────────────────────────────────────────────
export type { CandleData } from "./utils/smcEngine";

// ── Analysis & Indicator Engines ─────────────────────────────────────────────
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
