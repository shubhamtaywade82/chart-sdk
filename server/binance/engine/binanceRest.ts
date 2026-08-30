import { EngineCandle, FundingInfo } from "./types";
import { DepthSnapshotRaw } from "./depthSync";

const REST_BASE = "https://fapi.binance.com";

export async function fetchKlines(symbol: string, interval: string, limit: number): Promise<EngineCandle[]> {
  const url = `${REST_BASE}/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchKlines: HTTP ${res.status}`);
  const raw = (await res.json()) as (string | number)[][];
  return raw.map((k) => ({
    t: Number(k[0]),
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
    bv: Number(k[9] || 0),
  }));
}

export async function fetchDepthSnapshot(symbol: string, limit: number): Promise<DepthSnapshotRaw> {
  const url = `${REST_BASE}/fapi/v1/depth?symbol=${symbol.toUpperCase()}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchDepthSnapshot: HTTP ${res.status}`);
  const raw = (await res.json()) as { lastUpdateId: number; bids: [string, string][]; asks: [string, string][] };
  return { lastUpdateId: raw.lastUpdateId, bids: raw.bids, asks: raw.asks };
}

export async function fetchFundingAndOI(symbol: string): Promise<FundingInfo> {
  const sym = symbol.toUpperCase();
  const [premiumRes, oiRes] = await Promise.all([
    fetch(`${REST_BASE}/fapi/v1/premiumIndex?symbol=${sym}`),
    fetch(`${REST_BASE}/fapi/v1/openInterest?symbol=${sym}`),
  ]);
  if (!premiumRes.ok) throw new Error(`fetchFundingAndOI: premiumIndex HTTP ${premiumRes.status}`);
  if (!oiRes.ok) throw new Error(`fetchFundingAndOI: openInterest HTTP ${oiRes.status}`);
  const premium = (await premiumRes.json()) as { lastFundingRate: string; nextFundingTime: number };
  const oi = (await oiRes.json()) as { openInterest: string };
  return {
    fundingRate: Number(premium.lastFundingRate),
    openInterest: Number(oi.openInterest),
    nextFundingTime: Number(premium.nextFundingTime),
  };
}
