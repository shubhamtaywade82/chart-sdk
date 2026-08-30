export interface EngineCandle {
  t: number; // open time, ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // base asset volume
  bv: number; // taker buy base asset volume
}

export interface EngineTrade {
  id: number;
  time: number;
  price: number;
  qty: number;
  isSell: boolean; // true = taker sold (matches Binance's `m` / buyer-is-maker flag)
  usd: number;
}

export interface DepthLevel {
  price: number;
  qty: number;
}

export interface OrderBookState {
  bids: DepthLevel[]; // sorted descending by price
  asks: DepthLevel[]; // sorted ascending by price
  lastUpdateId: number;
}

export interface WallLevel {
  price: number;
  qty: number;
  side: "bid" | "ask";
  ageMs: number;
}

export interface FundingInfo {
  fundingRate: number;
  openInterest: number;
  nextFundingTime: number;
}

export interface LiquidationEvent {
  price: number;
  qty: number;
  side: "buy" | "sell"; // side of the liquidation order itself
  time: number;
}

export interface AbsorptionEvent {
  price: number;
  side: "bid" | "ask"; // side of the wall being absorbed
  qty: number; // the wall's size at detection time
  detectedAt: number;
}

export type EngineMessage =
  | {
      type: "snapshot";
      symbol: string;
      candles: EngineCandle[];
      book: OrderBookState;
      trades: EngineTrade[];
      cvd: number;
      walls: WallLevel[];
      imbalance: number;
      absorptions: AbsorptionEvent[];
      funding: FundingInfo;
    }
  | { type: "candle"; symbol: string; candle: EngineCandle }
  | {
      type: "book";
      symbol: string;
      bids: DepthLevel[];
      asks: DepthLevel[];
      walls: WallLevel[];
      imbalance: number;
      absorptions: AbsorptionEvent[];
    }
  | { type: "trade"; symbol: string; trade: EngineTrade; cvd: number }
  | { type: "liquidation"; symbol: string; liq: LiquidationEvent }
  | { type: "funding"; symbol: string; funding: FundingInfo };
