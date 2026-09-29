import { WebSocketServer, WebSocket } from "ws";
import { SymbolEngine } from "./engine/SymbolEngine";
import { EngineMessage } from "./engine/types";

const DEFAULT_INTERVAL = "1m";
const ALLOWED_INTERVALS = new Set(["1m", "15m", "1h", "4h", "1d"]);

interface SymbolEntry {
  engine: SymbolEngine;
  subscriberCount: number;
  clients: Set<WebSocket>;
  startPromise: Promise<void>;
}

export class WebSocketFeedService {
  // Keyed by `${symbol}:${interval}` — one engine per symbol+timeframe combo, since candles
  // only make sense for the interval they were seeded/streamed at.
  private static engines = new Map<string, SymbolEntry>();

  public static attach(wss: WebSocketServer): void {
    wss.on("connection", (ws: WebSocket) => {
      console.log("🔌 client connected");
      let currentKey: string | null = null;

      const unsubscribeCurrent = () => {
        if (!currentKey) return;
        const entry = this.engines.get(currentKey);
        if (entry) {
          // Only decrement if this ws was actually registered — every subscriber now awaits
          // entry.startPromise before joining entry.clients (Fix 3), so a close during that
          // window must not decrement a count this client never added to.
          if (entry.clients.delete(ws)) {
            entry.subscriberCount--;
            if (entry.subscriberCount <= 0) {
              entry.engine.stop();
              this.engines.delete(currentKey);
              console.log(`🧹 stopped engine for idle stream: ${currentKey}`);
            }
          }
        }
        currentKey = null;
      };

      const subscribeTo = async (symbolRaw: string, intervalRaw: string) => {
        const symbol = symbolRaw.toLowerCase();
        const interval = intervalRaw;
        const key = `${symbol}:${interval}`;
        // Re-subscribing to the stream already active for this client is a no-op — tearing
        // it down here would drive subscriberCount negative and kill a still-wanted engine.
        if (currentKey === key) return;
        unsubscribeCurrent();
        currentKey = key;

        let entry = this.engines.get(key);
        if (!entry) {
          const engine = new SymbolEngine(symbol, interval);
          const newEntry: SymbolEntry = {
            engine,
            subscriberCount: 0,
            clients: new Set(),
            startPromise: engine.start().catch((err) => {
              this.engines.delete(key);
              engine.stop();
              throw err;
            }),
          };
          entry = newEntry;
          this.engines.set(key, entry);
          engine.on("update", (msg: Exclude<EngineMessage, { type: "snapshot" }>) => {
            this.broadcast(newEntry, msg);
          });
        }
        // Shared across every subscriber to this stream — a second subscriber arriving while
        // the engine is still starting awaits the SAME promise instead of reading an empty snapshot.
        await entry.startPromise;

        // If this socket closed, or moved on to a different stream, while we were waiting for
        // the engine to seed, its close/re-subscribe already fired and won't fire again — joining
        // now would register a client nothing will ever unsubscribe, leaking this engine's WS
        // stream, funding poll, and flush timer forever.
        if (currentKey !== key || ws.readyState !== WebSocket.OPEN) {
          // Nobody else joined this engine either (it was just created for this now-stale
          // subscriber) — nothing will ever call unsubscribeCurrent for it, so reap it here
          // instead of leaving a zero-subscriber engine running forever.
          if (entry.subscriberCount === 0 && entry.clients.size === 0 && this.engines.get(key) === entry) {
            entry.engine.stop();
            this.engines.delete(key);
            console.log(`🧹 stopped orphaned engine nobody ended up subscribing to: ${key}`);
          }
          return;
        }

        entry.subscriberCount++;
        entry.clients.add(ws);

        if (ws.readyState === WebSocket.OPEN) {
          const snapshot = entry.engine.getSnapshotMessage();
          ws.send(JSON.stringify(snapshot));
          ws.send(JSON.stringify(this.toLegacyTick(snapshot)));
        }
      };

      ws.on("message", (raw) => {
        try {
          const parsed = JSON.parse(raw.toString());
          const isValidSymbol = typeof parsed.symbol === "string" && /^[a-zA-Z0-9]{2,20}$/.test(parsed.symbol);
          const interval = typeof parsed.interval === "string" && ALLOWED_INTERVALS.has(parsed.interval)
            ? parsed.interval
            : DEFAULT_INTERVAL;
          if (parsed.type === "subscribe" && isValidSymbol) {
            subscribeTo(parsed.symbol, interval).catch((err) => console.error("subscribe failed:", err));
          }
        } catch {}
      });

      ws.on("close", () => {
        unsubscribeCurrent();
        console.log("🔌 client disconnected");
      });
    });
  }

  private static broadcast(entry: SymbolEntry, msg: Exclude<EngineMessage, { type: "snapshot" }>): void {
    const payload = JSON.stringify(msg);
    const legacyPayload = msg.type === "candle" || msg.type === "book"
      ? JSON.stringify(entry.engine.getLatestTick())
      : null;
    for (const client of entry.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      try {
        client.send(payload);
        if (legacyPayload) client.send(legacyPayload);
      } catch {}
    }
  }

  /** Backward-compat shape for the not-yet-migrated frontend (BinanceAdapter/App.tsx `tick` handler). */
  private static toLegacyTick(snapshot: Extract<EngineMessage, { type: "snapshot" }>) {
    const last = snapshot.candles[snapshot.candles.length - 1];
    const prev = snapshot.candles[snapshot.candles.length - 2];
    // Klines are the stream most likely to stall; prefer live trade price, then book mid,
    // so the header price doesn't silently freeze. prevClose/change stay kline-derived (longer window).
    const bestBid = snapshot.book.bids[0]?.price;
    const bestAsk = snapshot.book.asks[0]?.price;
    const midPrice = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : undefined;
    const ltp = snapshot.trades[0]?.price ?? midPrice ?? last?.c ?? 0;
    const prevClose = prev?.c ?? ltp;
    return {
      type: "tick",
      symbol: snapshot.symbol,
      securityId: snapshot.symbol.toUpperCase(),
      ltp,
      prevClose,
      change: Number((ltp - prevClose).toFixed(2)),
      pChange: prevClose > 0 ? Number((((ltp - prevClose) / prevClose) * 100).toFixed(2)) : 0,
      volume: last?.v ?? 0,
      bids: snapshot.book.bids.map((l) => ({ price: l.price, quantity: l.qty, orders: 1 })),
      asks: snapshot.book.asks.map((l) => ({ price: l.price, quantity: l.qty, orders: 1 })),
      timestamp: new Date().toISOString(),
    };
  }
}
