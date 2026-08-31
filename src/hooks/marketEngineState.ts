import type {
  EngineMessage,
  EngineTrade,
  LiquidationEvent,
  OrderBookState,
  WallLevel,
  AbsorptionEvent,
  FundingInfo,
} from "../../server/binance/engine/types";

export interface EngineState {
  book: OrderBookState;
  trades: EngineTrade[];
  cvd: number;
  windowedCvd: number;
  walls: WallLevel[];
  absorptions: AbsorptionEvent[];
  imbalance: number;
  liquidations: LiquidationEvent[];
  funding: FundingInfo;
}

const TRADE_HISTORY_CAP = 200;
const LIQUIDATION_HISTORY_CAP = 50;

export const initialEngineState: EngineState = {
  book: { bids: [], asks: [], lastUpdateId: 0 },
  trades: [],
  cvd: 0,
  windowedCvd: 0,
  walls: [],
  absorptions: [],
  imbalance: 0.5,
  liquidations: [],
  funding: { fundingRate: 0, openInterest: 0, nextFundingTime: 0 },
};

export function applyEngineMessage(state: EngineState, msg: EngineMessage): EngineState {
  switch (msg.type) {
    case "snapshot":
      return {
        book: msg.book,
        trades: msg.trades,
        cvd: msg.cvd,
        windowedCvd: msg.windowedCvd,
        walls: msg.walls,
        absorptions: msg.absorptions,
        imbalance: msg.imbalance,
        liquidations: state.liquidations,
        funding: msg.funding,
      };
    case "book":
      return {
        ...state,
        book: { bids: msg.bids, asks: msg.asks, lastUpdateId: state.book.lastUpdateId },
        walls: msg.walls,
        absorptions: msg.absorptions,
        imbalance: msg.imbalance,
      };
    case "trade":
      return {
        ...state,
        trades: [msg.trade, ...state.trades].slice(0, TRADE_HISTORY_CAP),
        cvd: msg.cvd,
        windowedCvd: msg.windowedCvd,
      };
    case "liquidation":
      return {
        ...state,
        liquidations: [msg.liq, ...state.liquidations].slice(0, LIQUIDATION_HISTORY_CAP),
      };
    case "funding":
      return { ...state, funding: msg.funding };
    case "candle":
      return state;
    default:
      return state;
  }
}
