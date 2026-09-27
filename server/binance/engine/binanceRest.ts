import type { KlineInterval } from "@nemesis-oss/binance-sdk";
import { binanceClient } from "./binanceClient";
import { EngineCandle, FundingInfo } from "./types";
import { DepthSnapshotRaw } from "./depthSync";

export async function fetchKlines(symbol: string, interval: string, limit: number): Promise<EngineCandle[]> {
  const klines = await binanceClient.futures.market.klines(symbol.toUpperCase(), interval as KlineInterval, { limit });
  return klines.map((k) => ({
    t: k.openTime,
    o: k.open,
    h: k.high,
    l: k.low,
    c: k.close,
    v: k.volume,
    bv: k.takerBuyBaseVolume,
  }));
}

export async function fetchDepthSnapshot(symbol: string, limit: number): Promise<DepthSnapshotRaw> {
  const snap = await binanceClient.futures.market.depth(symbol.toUpperCase(), limit);
  return {
    lastUpdateId: snap.lastUpdateId,
    bids: snap.bids.map((l): [string, string] => [String(l.price), String(l.qty)]),
    asks: snap.asks.map((l): [string, string] => [String(l.price), String(l.qty)]),
  };
}

export async function fetchFundingAndOI(symbol: string): Promise<FundingInfo> {
  const sym = symbol.toUpperCase();
  const [premium, oi] = await Promise.all([
    binanceClient.futures.data.premiumIndex(sym),
    binanceClient.futures.data.openInterest(sym),
  ]);
  return {
    fundingRate: premium.lastFundingRate,
    openInterest: oi.openInterest,
    nextFundingTime: premium.nextFundingTime,
  };
}
