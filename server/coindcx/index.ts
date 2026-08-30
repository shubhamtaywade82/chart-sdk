import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { CoinDCXFuturesClient } from "coindcx-client-js";

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

// coindcx-client-js passes data:null on GET requests, which CoinDCX rejects (422);
// hit the public market-data API directly instead.
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

const getClient = (): CoinDCXFuturesClient => {
  return new CoinDCXFuturesClient({
    apiKey: FUTURES_API_KEY,
    apiSecret: FUTURES_API_SECRET,
    debug: process.env.COINDCX_DEBUG === "true",
  });
};

const requireClient = (): CoinDCXFuturesClient => {
  if (!FUTURES_API_KEY || !FUTURES_API_SECRET) {
    throw new Error("CoinDCX credentials not configured — set COINDCX_API_KEY/COINDCX_API_SECRET in .env");
  }
  return getClient();
};

const normalizePosition = (p: any) => {
  const pair = p.pair || p.symbol || "";
  const size = Math.abs(round(p.size ?? p.quantity ?? p.qty));
  const rawSide = String(p.side || p.position_side || "").toLowerCase();
  const side = rawSide.startsWith("short") ? "SHORT" : rawSide.startsWith("long") ? "LONG" : size > 0 ? (Number(p.size) < 0 ? "SHORT" : "LONG") : "LONG";
  return {
    positionId: String(p.position_id ?? p.id ?? ""),
    pair,
    symbol: pairToSymbol(pair),
    side,
    qty: size,
    entryPrice: round(p.entry_price ?? p.entryPrice),
    markPrice: round(p.mark_price ?? p.markPrice),
    stopLoss: round(p.stop_loss ?? p.stopLoss),
    takeProfit: round(p.take_profit ?? p.takeProfit),
    liquidationPrice: round(p.liquidation_price ?? p.liquidationPrice),
    margin: round(p.margin),
    leverage: Number(p.leverage || 1),
    unrealizedPnl: round(p.unrealised_pnl ?? p.unrealized_pnl ?? p.pnl),
    marginType: p.margin_type || "cross",
    createdAt: p.created_at || null,
  };
};

const normalizeWallet = (wallets: any[]) => {
  const rows = Array.isArray(wallets) ? wallets : [];
  const usdt = rows.find((w) => w.currency === "USDT") || rows[0] || {};
  const availMargin = round(usdt.available_balance ?? usdt.availableBalance ?? 0);
  const usedMargin = round(usdt.margin_used ?? usdt.marginUsed ?? 0);
  const unrealizedPnl = round(usdt.unrealised_pnl ?? usdt.unrealizedPnl ?? 0);
  return {
    availMargin,
    usedMargin,
    equity: availMargin + usedMargin + unrealizedPnl,
    currency: usdt.currency || "USDT",
    unrealizedPnl,
    balances: rows.map((w) => ({
      currency: w.currency,
      availableBalance: round(w.available_balance ?? w.availableBalance),
      marginUsed: round(w.margin_used ?? w.marginUsed),
      unrealizedPnl: round(w.unrealised_pnl ?? w.unrealizedPnl),
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
    // client marks the futures wallet route as public; hit it via the private path so auth headers are attached
    const data = await (client as any)._request("GET", "/exchange/v1/derivatives/futures/wallets", {});
    res.json({ status: "success", data: normalizeWallet(data) });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.data });
  }
});

app.get("/api/positions", async (_req, res) => {
  try {
    const client = requireClient();
    const raw = await client.getFuturesPositions({});
    const data = (Array.isArray(raw) ? raw : []).map(normalizePosition);
    res.json({ status: "success", data });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.data });
  }
});

app.get("/api/orders", async (_req, res) => {
  try {
    const client = requireClient();
    const raw = await client.listFuturesOrders({});
    const data = (Array.isArray(raw) ? raw : []).map((o: any) => ({
      id: String(o.id ?? o.order_id ?? ""),
      pair: o.pair || o.symbol || "",
      symbol: pairToSymbol(o.pair || o.symbol || ""),
      side: String(o.side || "").toUpperCase(),
      type: o.order_type || o.type || "LIMIT",
      price: round(o.price),
      qty: round(o.quantity ?? o.qty),
      status: o.status || "open",
      createdAt: o.created_at || o.createdAt || null,
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
        await client.cancelAllFuturesOrders();
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
    const orderPayload: any = {
      pair,
      side: String(side || "buy").toLowerCase(),
      order_type: String(orderType || "limit_order").toLowerCase(),
      total_quantity: Number(quantity),
      leverage: Number(leverage || 1),
    };
    if (price && Number(price) > 0) orderPayload.price = Number(price);
    if (stopPrice && Number(stopPrice) > 0) orderPayload.stop_price = Number(stopPrice);

    const result = await client.createFuturesOrder(orderPayload);
    res.json({ status: "success", data: result });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message, details: err.data });
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  if (!checkLiveTradingGuard(res)) return;
  try {
    const client = requireClient();
    const result = await client.cancelFuturesOrder(req.params.id);
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
      result = await client.closeFuturesPosition(positionId);
    } else if (symbol) {
      const pair = symbolToPair(symbol);
      result = await client.exitFuturesPosition(pair);
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
let dealClient: CoinDCXFuturesClient | null = null;
let clientConnected = false;
let accountWsStarted = false;

const depthByPair = new Map<string, { bids: any[]; asks: any[] }>();
const lastTickByPair = new Map<string, { price: number; change: number; pChange: number; prevClose: number }>();

const ensureDealClient = async (): Promise<CoinDCXFuturesClient | null> => {
  if (dealClient && clientConnected) return dealClient;
  if (dealClient) {
    try { dealClient.wsDisconnect(); } catch {}
  }
  dealClient = new CoinDCXFuturesClient({
    apiKey: FUTURES_API_KEY,
    apiSecret: FUTURES_API_SECRET,
    debug: process.env.COINDCX_DEBUG === "true",
  });
  dealClient.on("ws:candlestick", (candle: any) => {
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
  dealClient.on("ws:depth-snapshot", (depth: any) => { depthByPair.set(depth.pair || "", { bids: depth.bids || [], asks: depth.asks || [] }); });
  dealClient.on("ws:depth-update", (depth: any) => { depthByPair.set((depth as any).pair || "", { bids: depth.bids || [], asks: depth.asks || [] }); });
  dealClient.on("ws:price-change", (update: any) => {
    const pair = update.pair || update.symbol || "";
    const prev = lastTickByPair.get(pair);
    const price = Number(update.price);
    if (prev && prev.price > 0) {
      prev.change = round(price - prev.price, 4);
      prev.pChange = round(((price - prev.price) / prev.price) * 100, 4);
    }
    lastTickByPair.set(pair, { price, change: prev?.change || 0, pChange: prev?.pChange || 0, prevClose: prev?.prevClose || price });
  });
  dealClient.on("ws:df-position-update", (data: any) => broadcast({ type: "account", kind: "positions", data }));
  dealClient.on("ws:df-order-update", (data: any) => broadcast({ type: "account", kind: "orders", data }));
  dealClient.on("ws:balance-update", (data: any) => broadcast({ type: "account", kind: "balances", data }));

  try {
    await dealClient.wsConnect();
    dealClient.wsSubscribeCurrentPricesFutures();
    if (FUTURES_API_KEY && FUTURES_API_SECRET) {
      try { dealClient.wsSubscribeAccountFutures(); accountWsStarted = true; } catch {}
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
  client.wsSubscribeCandles(pair, "1m");
  client.wsSubscribeOrderBook(pair, 50);
  client.wsSubscribePrices(pair);
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