import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { CoinDCXClient } from "@nemesis-oss/coindcx-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../../.env") });
dotenv.config({ path: path.join(__dirname, "../.env") });

const PORT = Number(process.env.COINDCX_PORT || process.env.PORT || 3004);

const FUTURES_API_KEY = (process.env.COINDCX_FUTURES_API_KEY || process.env.COINDCX_API_KEY || "").trim();
const FUTURES_API_SECRET = (process.env.COINDCX_FUTURES_API_SECRET || process.env.COINDCX_API_SECRET || "")
  .trim()
  .replace(/-F$/, "");

const SYMBOL_PAIRS: Record<string, string> = {
  btcusdt: "B-BTC_USDT",
  ethusdt: "B-ETH_USDT",
  solusdt: "B-SOL_USDT",
  bnbusdt: "B-BNB_USDT",
  xrpusdt: "B-XRP_USDT",
  dogeusdt: "B-DOGE_USDT",
};

const symbolToPair = (symbol: string): string => {
  const key = String(symbol || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return SYMBOL_PAIRS[key] ?? `B-${key.replace(/usdt$/i, "").toUpperCase()}_USDT`;
};

const pairToSymbol = (pair: string): string => {
  const match = String(pair || "").match(/^[A-Z]-([A-Z0-9]+)_([A-Z0-9]+)$/);
  if (!match) return String(pair || "").toLowerCase();
  return `${match[1]}${match[2]}`.toLowerCase();
};

const pairToBaseQuote = (pair: string): { base: string; quote: string } => {
  const match = String(pair || "").match(/^[A-Z]-([A-Z0-9]+)_([A-Z0-9]+)$/);
  return match ? { base: match[1], quote: match[2] } : { base: pair, quote: "USDT" };
};

const depthMapToLevels = (
  map: Record<string, number | string> | undefined
): { price: number; quantity: number; orders: number }[] => {
  if (!map) return [];
  return Object.entries(map)
    .map(([price, qty]) => ({ price: Number(price), quantity: Number(qty), orders: 0 }))
    .filter((l) => l.quantity > 0);
};

const intervalToCoindcx = (interval: string): string => {
  const k = String(interval || "").trim().toLowerCase();
  if (k === "60" || k === "1h") return "1h";
  if (k === "4h" || k === "1d") return k;
  return `${k}m`;
};

const candleToNormalized = (c: any) => ({
  time: Math.floor((Number(c.time || c.open_time || 0) < 1e11 ? Number(c.time || c.open_time || 0) : Number(c.time || c.open_time || 0) / 1000)),
  open: Number(c.open || 0),
  high: Number(c.high || 0),
  low: Number(c.low || 0),
  close: Number(c.close || 0),
  volume: Number(c.volume || c.vol || 0),
});

const round = (n: any, d = 6): number => {
  const v = Number(n);
  if (isNaN(v)) return 0;
  return Number(v.toFixed(d));
};

// Public candle history has no auth requirement; hit CoinDCX's public
// market-data API directly instead of routing it through the signed client.
const publicGet = async (path: string, params: Record<string, any>) => {
  const { default: axios } = await import("axios");
  const res = await axios({
    method: "GET",
    url: `https://public.coindcx.com${path}`,
    params,
    headers: { "Content-Type": "application/json", "User-Agent": "ChartSDK/1.0" },
    timeout: 15000,
  });
  return res.data;
};

const getFuturesCandles = async (pair: string, from?: number, to?: number, resolution = "15m", limit = 500) => {
  const params: Record<string, any> = { pair, interval: resolution, limit };
  if (from) params.startTime = from * 1000;
  if (to) params.endTime = to * 1000;
  const res = await publicGet("/market_data/candles", params);
  return (Array.isArray(res) ? [...res].reverse() : []).map(candleToNormalized);
};

const getClient = (): CoinDCXClient => {
  return new CoinDCXClient({
    apiKey: FUTURES_API_KEY,
    apiSecret: FUTURES_API_SECRET,
    debug: process.env.COINDCX_DEBUG === "true",
  });
};

const requireClient = (): CoinDCXClient => {
  if (!FUTURES_API_KEY || !FUTURES_API_SECRET) {
    throw new Error("CoinDCX credentials not configured — set COINDCX_API_KEY/COINDCX_API_SECRET in .env");
  }
  return getClient();
};

const normalizePosition = (p: any) => {
  const pair = p.pair || "";
  const size = Math.abs(round(p.size));
  const side = String(p.side || "").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  return {
    positionId: String(p.id ?? ""),
    pair,
    symbol: pairToSymbol(pair),
    side,
    qty: size,
    entryPrice: round(p.entry_price),
    markPrice: round(p.mark_price),
    // ponytail: coindcx-sdk's PositionResponse doesn't carry stop_loss/take_profit
    // (those live on bracket orders, not the position). Wire up createTPSL if the
    // UI needs these displayed again.
    stopLoss: 0,
    takeProfit: 0,
    liquidationPrice: round(p.liquidation_price),
    margin: round(p.margin),
    leverage: Number(p.leverage || 1),
    unrealizedPnl: round(p.unrealized_pnl),
    marginType: p.margin_type || "cross",
    createdAt: p.timestamp || null,
  };
};

const normalizeWallet = (wallets: any[], unrealizedPnl: number) => {
  const rows = Array.isArray(wallets) ? wallets : [];
  const usdt = rows.find((w) => w.currency === "USDT") || rows[0] || {};
  const availMargin = round(usdt.available_balance ?? 0);
  const balance = round(usdt.balance ?? 0);
  const locked = round(usdt.locked_balance ?? 0);
  // ponytail: coindcx-sdk's FuturesWalletResponse has no margin_used field;
  // derive it from balance - available - locked (funds tied up in open positions).
  const usedMargin = Math.max(0, round(balance - availMargin - locked));
  return {
    availMargin,
    usedMargin,
    equity: availMargin + usedMargin + unrealizedPnl,
    currency: usdt.currency || "USDT",
    unrealizedPnl: round(unrealizedPnl),
    balances: rows.map((w) => ({
      currency: w.currency,
      availableBalance: round(w.available_balance),
      marginUsed: Math.max(0, round((w.balance ?? 0) - (w.available_balance ?? 0) - (w.locked_balance ?? 0))),
      unrealizedPnl: 0,
    })),
  };
};

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/feed" });

app.get("/api/session-info", (_req, res) => {
  res.json({
    status: "success",
    session: {
      isOpen: true,
      exchange: "COINDCX",
      marketType: "CRYPTO_FUTURES_24X7",
      lastCompletedTradingDay: new Date().toISOString().split("T")[0],
    },
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "success",
    wsConnected: clientConnected,
    credentialsConfigured: Boolean(FUTURES_API_KEY && FUTURES_API_SECRET),
  });
});

app.get("/api/funds", async (_req, res) => {
  try {
    const client = requireClient();
    const [wallets, positions] = await Promise.all([
      client.futures.account.getWallet(),
      client.futures.account.getPositions({}),
    ]);
    const unrealizedPnl = (Array.isArray(positions) ? positions : []).reduce(
      (sum: number, p: any) => sum + Number(p.unrealized_pnl || 0),
      0
    );
    res.json({ status: "success", data: normalizeWallet(wallets, unrealizedPnl) });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.data });
  }
});

app.get("/api/positions", async (_req, res) => {
  try {
    const client = requireClient();
    const raw = await client.futures.account.getPositions({});
    const data = (Array.isArray(raw) ? raw : []).map(normalizePosition);
    res.json({ status: "success", data });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.data });
  }
});

app.get("/api/orders", async (_req, res) => {
  try {
    const client = requireClient();
    const raw = await client.futures.account.listOrders({});
    const data = (Array.isArray(raw) ? raw : []).map((o: any) => ({
      id: String(o.id ?? ""),
      pair: o.pair || "",
      symbol: pairToSymbol(o.pair || ""),
      side: String(o.side || "").toUpperCase(),
      type: o.order_type || "LIMIT",
      price: round(o.price),
      qty: round(o.target_quantity),
      status: o.status || "open",
      createdAt: o.created_at || null,
    }));
    res.json({ status: "success", data });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.data });
  }
});

let coindcxKillSwitch = false;

app.get("/api/trader-controls", (_req, res) => {
  res.json({
    killSwitch: { killSwitchStatus: coindcxKillSwitch ? "ACTIVATED" : "DEACTIVATED" },
  });
});

app.post("/api/trader-controls/killswitch", async (_req, res) => {
  try {
    coindcxKillSwitch = !coindcxKillSwitch;
    if (coindcxKillSwitch) {
      try {
        const client = requireClient();
        await client.futures.trading.cancelAllOrders({ pair: undefined, side: undefined });
      } catch {}
    }
    res.json({ status: "success", killSwitch: { killSwitchStatus: coindcxKillSwitch ? "ACTIVATED" : "DEACTIVATED" } });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Hard Safety Guard: Live order placement, cancellation, and position exit are DISABLED by default
let liveTradingAllowed = process.env.COINDCX_ENABLE_LIVE_ORDERS === "true";

const checkLiveTradingGuard = (res: express.Response): boolean => {
  if (!liveTradingAllowed) {
    res.status(403).json({
      status: "error",
      code: "LIVE_EXECUTION_BLOCKED",
      error: "Live order execution is HARD-DISABLED by default for safety. Only read-only data fetching (funds, positions, orders, klines) is enabled.",
    });
    return false;
  }
  return true;
};

app.get("/api/execution-guard/status", (_req, res) => {
  res.json({
    status: "success",
    liveTradingAllowed,
    hasCredentials: Boolean(FUTURES_API_KEY && FUTURES_API_SECRET),
  });
});

app.post("/api/execution-guard/toggle", (req, res) => {
  const { enable } = req.body;
  liveTradingAllowed = Boolean(enable);
  res.json({
    status: "success",
    liveTradingAllowed,
  });
});

app.post("/api/orders", async (req, res) => {
  if (!checkLiveTradingGuard(res)) return;
  try {
    const client = requireClient();
    const { symbol, side, orderType, price, quantity, leverage, stopPrice } = req.body;
    const pair = symbolToPair(symbol || "BTCUSDT");
    const normalizedOrderType = String(orderType || "limit_order").toLowerCase();

    if (normalizedOrderType === "stop_limit_order" && stopPrice) {
      // coindcx-sdk's CreateFuturesOrderRequest has no entry-trigger price field
      // (only stop_loss/take_profit brackets on an existing position). Fail fast
      // instead of silently placing an unprotected market/limit order.
      res.status(400).json({
        error:
          "stop_limit orders are not supported via @nemesis-oss/coindcx-sdk's createOrder — use limit/market orders, or attach stop-loss/take-profit via a bracket order.",
      });
      return;
    }

    const { base, quote } = pairToBaseQuote(pair);
    const orderPayload = {
      base_currency: base,
      quote_currency: quote,
      side: String(side || "buy").toLowerCase() as "buy" | "sell",
      order_type: normalizedOrderType as "market_order" | "limit_order" | "stop_limit_order",
      target_quantity: Number(quantity),
      leverage: Number(leverage || 1),
      price: price && Number(price) > 0 ? Number(price) : undefined,
      client_order_id: undefined,
      time_in_force: undefined,
      stop_loss: undefined,
      take_profit: undefined,
      margin_type: undefined,
    };

    const result = await client.futures.trading.createOrder(orderPayload);
    res.json({ status: "success", data: result });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.data });
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  if (!checkLiveTradingGuard(res)) return;
  try {
    const client = requireClient();
    const result = await client.futures.trading.cancelOrder({ id: req.params.id });
    res.json({ status: "success", data: result });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.data });
  }
});

app.post("/api/positions/close", async (req, res) => {
  if (!checkLiveTradingGuard(res)) return;
  try {
    const client = requireClient();
    const { symbol, positionId } = req.body;
    let result;
    if (positionId) {
      result = await client.futures.trading.closePosition({ id: positionId });
    } else if (symbol) {
      const pair = symbolToPair(symbol);
      result = await client.futures.trading.exitPosition({ pair });
    }
    res.json({ status: "success", data: result });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.data });
  }
});

app.get("/api/credentials/status", (_req, res) => {
  res.json({
    hasCredentials: Boolean(FUTURES_API_KEY && FUTURES_API_SECRET),
    keyMasked: FUTURES_API_KEY ? `${FUTURES_API_KEY.slice(0, 4)}...${FUTURES_API_KEY.slice(-4)}` : null,
    liveTradingAllowed,
  });
});

app.get("/api/charts/intraday", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "btcusdt");
    const interval = String(req.query.interval || "15");
    const limit = Number(req.query.limit || 500);
    const pair = symbolToPair(symbol);
    const candles = await getFuturesCandles(pair, undefined, undefined, intervalToCoindcx(interval), Math.min(1000, limit));
    res.json({ candles });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.data });
  }
});

app.get("/api/charts/historical", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "btcusdt");
    const interval = String(req.query.interval || "15");
    const from = Math.floor(new Date(String(req.query.fromDate)).getTime() / 1000);
    const to = Math.floor(new Date(String(req.query.toDate)).getTime() / 1000);
    const pair = symbolToPair(symbol);
    const candles = await getFuturesCandles(pair, from, to, intervalToCoindcx(interval), 1000);
    res.json({ candles });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.data });
  }
});

// ── Live market + account feed bridge ──
let dealClient: CoinDCXClient | null = null;
let clientConnected = false;
let accountWsStarted = false;

const depthByPair = new Map<string, { bids: { price: number; quantity: number; orders: number }[]; asks: { price: number; quantity: number; orders: number }[] }>();
const lastTickByPair = new Map<string, { price: number; change: number; pChange: number; prevClose: number }>();

// coindcx-sdk's PublicStreams.onDepthSnapshot/onDepthUpdate normalize away the
// pair the update belongs to, so multi-pair depth can't be routed through them.
// Hook the raw socket events instead — same shape the SDK's own normalizeDepth
// reads from, just without dropping the pair field.
const parseRawWsPayload = (raw: any): any =>
  raw?.data && typeof raw.data === "string" ? JSON.parse(raw.data) : raw;

const handleRawDepth = (raw: any) => {
  const p = parseRawWsPayload(raw);
  const pair = p?.pair ?? p?.s ?? "unknown";
  depthByPair.set(pair, {
    bids: depthMapToLevels(p?.bids).sort((a, b) => b.price - a.price),
    asks: depthMapToLevels(p?.asks).sort((a, b) => a.price - b.price),
  });
};

const ensureDealClient = async (): Promise<CoinDCXClient | null> => {
  if (dealClient && clientConnected) return dealClient;
  if (dealClient) {
    try { dealClient.ws.disconnect(); } catch {}
  }
  dealClient = new CoinDCXClient({
    apiKey: FUTURES_API_KEY,
    apiSecret: FUTURES_API_SECRET,
    debug: process.env.COINDCX_DEBUG === "true",
  });
  dealClient.publicStreams.on("onCandle", (candle: any) => {
    const sym = pairToSymbol(candle.pair || candle.symbol || "");
    const msg = {
      type: "candle",
      securityId: sym,
      candle: {
        time: Math.floor(Number(candle.openTime) / 1000),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume),
      },
    };
    broadcast(msg);
    if (candle.close > 0) {
      lastTickByPair.set(candle.pair || "", { price: Number(candle.close), change: 0, pChange: 0, prevClose: Number(candle.open) });
    }
  });
  dealClient.ws.on("depth-snapshot", handleRawDepth);
  dealClient.ws.on("depth-update", handleRawDepth);
  dealClient.publicStreams.on("onPriceChange", (update: any) => {
    const pair = update.symbol || "";
    const prev = lastTickByPair.get(pair);
    const price = Number(update.price);
    if (prev && prev.price > 0) {
      prev.change = round(price - prev.price, 4);
      prev.pChange = round(((price - prev.price) / prev.price) * 100, 4);
    }
    lastTickByPair.set(pair, { price, change: prev?.change || 0, pChange: prev?.pChange || 0, prevClose: prev?.prevClose || price });
  });
  dealClient.privateStreams.on("onPositionUpdate", (data: any) => broadcast({ type: "account", kind: "positions", data }));
  dealClient.privateStreams.on("onOrderUpdate", (data: any) => broadcast({ type: "account", kind: "orders", data }));
  dealClient.privateStreams.on("onBalanceUpdate", (data: any) => broadcast({ type: "account", kind: "balances", data }));

  try {
    await dealClient.connectWebsocket();
    dealClient.publicStreams.subscribeCurrentPricesFutures();
    if (FUTURES_API_KEY && FUTURES_API_SECRET) {
      try { dealClient.subscribePrivateStreams(); accountWsStarted = true; } catch {}
    }
    clientConnected = true;
    return dealClient;
  } catch (err) {
    clientConnected = false;
    console.error("[coindcx] WebSocket connect failed:", err);
    return null;
  }
};

const subscribersByPair = new Map<string, number>();

const subscribePair = async (pair: string) => {
  const count = (subscribersByPair.get(pair) || 0) + 1;
  subscribersByPair.set(pair, count);
  const client = await ensureDealClient();
  if (!client) return;
  client.publicStreams.subscribeCandles(pair, "1m");
  client.publicStreams.subscribeOrderBook(pair, 50);
  client.publicStreams.subscribePrices(pair);
};

const unsubscribePair = (pair: string) => {
  const count = (subscribersByPair.get(pair) || 1) - 1;
  if (count <= 0) {
    subscribersByPair.delete(pair);
    depthByPair.delete(pair);
    lastTickByPair.delete(pair);
  } else {
    subscribersByPair.set(pair, count);
  }
};

const broadcast = (msg: any) => {
  const frame = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(frame);
  }
};

const sendTickLoop = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const pair = (ws as any).currentPair as string | null;
    if (!pair) continue;
    const tick = lastTickByPair.get(pair);
    const depth = depthByPair.get(pair);
    if (!tick || !tick.price) continue;
    ws.send(
      JSON.stringify({
        type: "tick",
        symbol: pair,
        securityId: pairToSymbol(pair),
        ltp: tick.price,
        prevClose: tick.prevClose,
        change: tick.change,
        pChange: tick.pChange,
        volume: 0,
        bids: depth?.bids || [],
        asks: depth?.asks || [],
        timestamp: new Date().toISOString(),
      })
    );
  }
}, 200);

wss.on("connection", (ws) => {
  console.log("[coindcx] UI client connected");
  ws.on("message", (msg: any) => {
    try {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === "subscribe" && parsed.symbol) {
        const pair = symbolToPair(parsed.symbol);
        const prevPair = (ws as any).currentPair as string | null;
        if (prevPair && prevPair !== pair) unsubscribePair(prevPair);
        (ws as any).currentPair = pair;
        subscribePair(pair);
      }
    } catch {}
  });
  ws.on("close", () => {
    const pair = (ws as any).currentPair as string | null;
    if (pair) unsubscribePair(pair);
  });
});

const distPath = path.join(__dirname, "../../dist/coindcx");
app.use(express.static(distPath));
app.get("*", (req, res) => {
  if (!req.path.startsWith("/api") && !req.path.startsWith("/ws")) {
    res.sendFile(path.join(distPath, "index.html"));
  }
});

server.listen(PORT, () => {
  console.log(`[coindcx] Backend server running at http://localhost:${PORT}`);
  if (!FUTURES_API_KEY || !FUTURES_API_SECRET) {
    console.log("[coindcx] Credentials missing — public market data works, account endpoints (funds/positions/orders) will return errors. Set COINDCX_API_KEY / COINDCX_API_SECRET in .env");
  } else {
    ensureDealClient();
  }
});