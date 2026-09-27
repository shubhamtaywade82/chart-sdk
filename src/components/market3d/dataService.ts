import { Candle3D, MarketStats, Timeframe3D } from "./types";

const BINANCE_REST_HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com",
];

const TIMEFRAME_MS: Record<Timeframe3D, number> = {
  "15m": 900000,
  "1h": 3600000,
  "4h": 14400000,
  "1d": 86400000,
};

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const FETCH_TIMEOUT_MS = 6000;
const DEFAULT_FALLBACK_PRICE = 180;
const MILLISECONDS_IN_24H = 86400000;

export function formatPrice(p: number): string {
  if (p >= 1000) {
    return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return p.toFixed(p < 1 ? 4 : 2);
}

export function formatVolume(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${Math.round(v)}`;
}

export function formatQty(q: number): string {
  if (q >= 1e4) return `${(q / 1e3).toFixed(1)}K`;
  if (q >= 100) return q.toFixed(1);
  return q.toFixed(2);
}

export function formatFullTimestamp(t: number): string {
  const d = new Date(t);
  const month = MONTH_NAMES[d.getUTCMonth()];
  const date = String(d.getUTCDate()).padStart(2, "0");
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const mins = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${date} · ${hours}:${mins} UTC`;
}

export function formatClock(t: number): string {
  const d = new Date(t);
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const mins = String(d.getUTCMinutes()).padStart(2, "0");
  const secs = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hours}:${mins}:${secs}`;
}

export function formatAxisTime(t: number, iv: string): string {
  const d = new Date(t);
  const month = MONTH_NAMES[d.getUTCMonth()];
  const date = d.getUTCDate();
  const hours = String(d.getUTCHours()).padStart(2, "0");

  if (iv === "1d") return `${month} ${date}`;
  if (iv === "4h") return `${date} ${hours}H`;
  return `${month}${date} ${hours}:00`;
}

export function calculateNiceTicks(min: number, max: number, n: number): number[] {
  const span = max - min;
  const raw = span / Math.max(n, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    out.push(v);
  }
  return out;
}

export async function restBinanceGet<T>(path: string): Promise<T> {
  let lastErr: unknown = null;
  for (const host of BINANCE_REST_HOSTS) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(`${host}${path}`, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All Binance REST hosts failed");
}

export async function pingBinanceTime(): Promise<number | null> {
  const t0 = performance.now();
  try {
    await restBinanceGet("/api/v3/time");
    return Math.round(performance.now() - t0);
  } catch {
    return null;
  }
}

export function generateSyntheticKlines(n: number, iv: Timeframe3D, base?: number): Candle3D[] {
  const out: Candle3D[] = [];
  let price = base || (DEFAULT_FALLBACK_PRICE + Math.random() * 24);
  let trend = 0;
  const step = TIMEFRAME_MS[iv] || TIMEFRAME_MS["1h"];
  const t0 = Date.now() - (n - 1) * step;

  for (let i = 0; i < n; i++) {
    trend = trend * 0.94 + (Math.random() - 0.5) * 0.9;
    const vol = price * 0.011;
    const open = price;
    const close = Math.max(0.01, open + trend * vol + (Math.random() - 0.5) * vol * 2.2);
    const high = Math.max(open, close) * (1 + Math.random() * 0.006);
    const low = Math.min(open, close) * (1 - Math.random() * 0.006);
    const volume = (0.4 + Math.random() * 1.6) * (Math.abs(close - open) / open * 8000 + 120) * 300;
    const buyVol = volume * (0.3 + Math.random() * 0.4);
    out.push({ t: t0 + i * step, o: open, h: high, l: low, c: close, v: volume, bv: buyVol });
    price = close;
  }
  return out;
}

export async function fetchKlinesFromBinance(
  symbol: string,
  interval: Timeframe3D,
  limit: number
): Promise<{ isSimulated: boolean; data: Candle3D[] }> {
  const cleanSymbol = symbol.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const binanceSymbol = cleanSymbol.endsWith("USDT") ? cleanSymbol : `${cleanSymbol}USDT`;

  try {
    const raw = await restBinanceGet<(string | number)[][]>(
      `/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`
    );
    if (!Array.isArray(raw) || raw.length === 0) throw new Error("Empty klines");

    const candles: Candle3D[] = raw.map((k) => ({
      t: Number(k[0]),
      o: Number(k[1]),
      h: Number(k[2]),
      l: Number(k[3]),
      c: Number(k[4]),
      v: Number(k[5]),
      bv: Number(k[9] || 0),
    }));
    return { isSimulated: false, data: candles };
  } catch {
    return { isSimulated: true, data: generateSyntheticKlines(limit, interval) };
  }
}

export function computeMarketStats(data: Candle3D[]): MarketStats {
  if (data.length === 0) {
    return { hi: 0, lo: 0, vol: 0, chg: 0, win: "24H" };
  }
  const last = data[data.length - 1];
  const cutoff = last.t - MILLISECONDS_IN_24H;
  let startIdx = data.findIndex((k) => k.t >= cutoff);
  let win = "24H";

  if (startIdx <= 0 || startIdx > data.length - 2) {
    startIdx = 0;
    win = "RANGE";
  }

  let hi = -Infinity;
  let lo = Infinity;
  let vol = 0;

  for (let i = startIdx; i < data.length; i++) {
    hi = Math.max(hi, data[i].h);
    lo = Math.min(lo, data[i].l);
    vol += data[i].v;
  }

  const chg = ((last.c - data[startIdx].o) / data[startIdx].o) * 100;
  return { hi, lo, vol, chg, win };
}
