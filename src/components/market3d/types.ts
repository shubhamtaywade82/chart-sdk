export interface Candle3D {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  bv?: number;
}

export interface TradeItem {
  id?: number;
  time: number;
  price: number;
  qty: number;
  isSell: boolean;
  usd: number;
}

export interface DepthLevel {
  price: number;
  qty: number;
  cum: number;
}

export interface DepthData {
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
}

export interface BookTicker {
  bid: number;
  ask: number;
  spread: number;
  spreadBps: number;
}

export type WsStatus = "live" | "connecting" | "reconnecting" | "sim" | "offline";
export type Timeframe3D = "15m" | "1h" | "4h" | "1d";

export interface MarketStats {
  hi: number;
  lo: number;
  vol: number;
  chg: number;
  win: string;
}

export interface Market3DProps {
  symbol?: string;
  defaultTimeframe?: Timeframe3D;
  defaultCandleCount?: number;
  onSymbolChange?: (symbol: string) => void;
}
