export type ScriptType = "indicator" | "strategy";
export type ScriptLanguage = "pine" | "javascript";

export interface ScriptInputDef {
  id: string;
  name: string;
  type: "int" | "float" | "bool" | "string" | "source";
  defaultValue: any;
  value?: any;
  min?: number;
  max?: number;
}

export interface CustomPlotDef {
  id: string;
  title: string;
  color: string;
  lineWidth?: number;
  style?: "line" | "histogram" | "circles" | "cross";
  data: { time: number; value: number }[];
}

export interface CustomShapeDef {
  id: string;
  time: number;
  price: number;
  style: "triangleup" | "triangledown" | "circle" | "cross" | "arrowup" | "arrowdown";
  color: string;
  text?: string;
  size?: "small" | "normal" | "large";
}

export interface CustomHLineDef {
  id: string;
  price: number;
  title: string;
  color: string;
  style?: "solid" | "dashed" | "dotted";
}

export interface StrategyTrade {
  id: number;
  entryTime: number;
  exitTime: number;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  size: number;
  profit: number;
  profitPercent: number;
  cumulativeProfit: number;
}

export interface StrategyEquityPoint {
  time: number;
  equity: number;
  drawdownPercent: number;
}

export interface StrategyStats {
  initialCapital: number;
  finalEquity: number;
  netProfit: number;
  netProfitPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  averageTradeProfit: number;
}

export interface ScriptExecutionResult {
  success: boolean;
  scriptId: string;
  name: string;
  type: ScriptType;
  overlay: boolean;
  plots: CustomPlotDef[];
  shapes: CustomShapeDef[];
  hlines: CustomHLineDef[];
  trades?: StrategyTrade[];
  equityCurve?: StrategyEquityPoint[];
  stats?: StrategyStats;
  logs: string[];
  error?: string;
}

export interface UserScript {
  id: string;
  name: string;
  type: ScriptType;
  language: ScriptLanguage;
  code: string;
  overlay: boolean;
  inputs?: ScriptInputDef[];
  isBuiltIn?: boolean;
  updatedAt: number;
}
