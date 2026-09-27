import { describe, it, expect } from "vitest";
import { applyEngineMessage, initialEngineState } from "./marketEngineState";
import type { EngineMessage, EngineTrade } from "../../server/binance/engine/types";

function trade(id: number, price: number, isSell: boolean): EngineTrade {
  return { id, time: Date.now(), price, qty: 1, isSell, usd: price };
}

describe("applyEngineMessage", () => {
  it("snapshot replaces book/trades/cvd/walls/absorptions/imbalance/funding wholesale", () => {
    const msg: EngineMessage = {
      type: "snapshot",
      symbol: "btcusdt",
      candles: [],
      book: { bids: [{ price: 100, qty: 1 }], asks: [{ price: 101, qty: 1 }], lastUpdateId: 5 },
      trades: [trade(1, 100, false)],
      cvd: 3,
      windowedCvd: 2,
      walls: [{ price: 100, qty: 50, side: "bid", ageMs: 1000 }],
      imbalance: 0.6,
      absorptions: [{ price: 100, side: "bid", qty: 50, detectedAt: 123 }],
      funding: { fundingRate: 0.0001, openInterest: 1000, nextFundingTime: 999 },
    };
    const state = applyEngineMessage(initialEngineState, msg);
    expect(state.book).toEqual(msg.book);
    expect(state.trades).toEqual(msg.trades);
    expect(state.cvd).toBe(3);
    expect(state.windowedCvd).toBe(2);
    expect(state.walls).toEqual(msg.walls);
    expect(state.imbalance).toBe(0.6);
    expect(state.absorptions).toEqual(msg.absorptions);
    expect(state.funding).toEqual(msg.funding);
  });

  it("snapshot does not touch liquidations (the backend's snapshot never carries them)", () => {
    const prior = { ...initialEngineState, liquidations: [{ price: 1, qty: 1, side: "sell" as const, time: 1 }] };
    const msg: EngineMessage = {
      type: "snapshot", symbol: "btcusdt", candles: [],
      book: { bids: [], asks: [], lastUpdateId: 0 }, trades: [], cvd: 0, windowedCvd: 0,
      walls: [], imbalance: 0.5, absorptions: [],
      funding: { fundingRate: 0, openInterest: 0, nextFundingTime: 0 },
    };
    const state = applyEngineMessage(prior, msg);
    expect(state.liquidations).toEqual(prior.liquidations);
  });

  it("book updates bids/asks/walls/absorptions/imbalance, preserves everything else", () => {
    const prior = { ...initialEngineState, cvd: 7, trades: [trade(1, 100, false)] };
    const msg: EngineMessage = {
      type: "book", symbol: "btcusdt",
      bids: [{ price: 99, qty: 2 }], asks: [{ price: 102, qty: 2 }],
      walls: [{ price: 99, qty: 40, side: "bid", ageMs: 500 }],
      imbalance: 0.3, absorptions: [],
    };
    const state = applyEngineMessage(prior, msg);
    expect(state.book.bids).toEqual(msg.bids);
    expect(state.book.asks).toEqual(msg.asks);
    expect(state.walls).toEqual(msg.walls);
    expect(state.imbalance).toBe(0.3);
    expect(state.cvd).toBe(7); // untouched
    expect(state.trades).toEqual(prior.trades); // untouched
  });

  it("trade prepends to trade history and updates cvd/windowedCvd", () => {
    const prior = { ...initialEngineState, trades: [trade(1, 100, false)] };
    const msg: EngineMessage = { type: "trade", symbol: "btcusdt", trade: trade(2, 101, true), cvd: 5, windowedCvd: 4 };
    const state = applyEngineMessage(prior, msg);
    expect(state.trades[0]).toEqual(msg.trade);
    expect(state.trades).toHaveLength(2);
    expect(state.cvd).toBe(5);
    expect(state.windowedCvd).toBe(4);
  });

  it("trade history is capped at 200 entries", () => {
    const many = Array.from({ length: 200 }, (_, i) => trade(i, 100, false));
    const prior = { ...initialEngineState, trades: many };
    const msg: EngineMessage = { type: "trade", symbol: "btcusdt", trade: trade(999, 100, false), cvd: 0, windowedCvd: 0 };
    const state = applyEngineMessage(prior, msg);
    expect(state.trades).toHaveLength(200);
    expect(state.trades[0].id).toBe(999);
  });

  it("liquidation prepends to liquidation history, capped at 50", () => {
    const msg: EngineMessage = { type: "liquidation", symbol: "btcusdt", liq: { price: 100, qty: 1, side: "sell", time: 1 } };
    const state = applyEngineMessage(initialEngineState, msg);
    expect(state.liquidations).toEqual([msg.liq]);
  });

  it("funding replaces the funding field only", () => {
    const prior = { ...initialEngineState, cvd: 9 };
    const msg: EngineMessage = { type: "funding", symbol: "btcusdt", funding: { fundingRate: 0.001, openInterest: 5, nextFundingTime: 1 } };
    const state = applyEngineMessage(prior, msg);
    expect(state.funding).toEqual(msg.funding);
    expect(state.cvd).toBe(9);
  });

  it("candle appends a new bar", () => {
    const msg: EngineMessage = { type: "candle", symbol: "btcusdt", candle: { t: 1, o: 1, h: 1, l: 1, c: 1, v: 1, bv: 1 } };
    const state = applyEngineMessage(initialEngineState, msg);
    expect(state.candles).toEqual([msg.candle]);
  });

  it("candle replaces the last bar when its open time matches", () => {
    const prior = { ...initialEngineState, candles: [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1, bv: 1 }] };
    const msg: EngineMessage = { type: "candle", symbol: "btcusdt", candle: { t: 1, o: 1, h: 2, l: 1, c: 1.5, v: 3, bv: 1 } };
    const state = applyEngineMessage(prior, msg);
    expect(state.candles).toEqual([msg.candle]);
  });
});
