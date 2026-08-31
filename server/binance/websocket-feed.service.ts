import { WebSocketServer, WebSocket } from "ws";
import { SymbolEngine } from "./engine/SymbolEngine";
import { EngineMessage } from "./engine/types";

const DEFAULT_INTERVAL = "1m";

interface SymbolEntry {
  engine: SymbolEngine;
  subscriberCount: number;
  clients: Set<WebSocket>;
  startPromise: Promise<void>;
}

export class WebSocketFeedService {
  private static engines = new Map<string, SymbolEntry>();

  public static attach(wss: WebSocketServer): void {
    wss.on("connection", (ws: WebSocket) => {
      console.log("🔌 client connected");
      let currentSymbol: string | null = null;

      const unsubscribeCurrent = () => {
        if (!currentSymbol) return;
        const entry = this.engines.get(currentSymbol);
        if (entry) {
          // Only decrement if this ws was actually registered — every subscriber now awaits
          // entry.startPromise before joining entry.clients (Fix 3), so a close during that
          // window must not decrement a count this client never added to.
          if (entry.clients.delete(ws)) {
            entry.subscriberCount--;
            if (entry.subscriberCount <= 0) {
              entry.engine.stop();
              this.engines.delete(currentSymbol);
              console.log(`🧹 stopped engine for idle symbol: ${currentSymbol}`);
            }
          }
        }
        currentSymbol = null;
      };

      const subscribeTo = async (symbolRaw: string) => {
        const symbol = symbolRaw.toLowerCase();
        // Re-subscribing to the symbol already active for this client is a no-op — tearing
        // it down here would drive subscriberCount negative and kill a still-wanted engine.
        if (currentSymbol === symbol) return;
        unsubscribeCurrent();
        currentSymbol = symbol;

        let entry = this.engines.get(symbol);
        if (!entry) {
          const engine = new SymbolEngine(symbol, DEFAULT_INTERVAL);
          const newEntry: SymbolEntry = {
            engine,
            subscriberCount: 0,
            clients: new Set(),
            startPromise: engine.start().catch((err) => {
              this.engines.delete(symbol);
              engine.stop();
              throw err;
            }),
          };
          entry = newEntry;
          this.engines.set(symbol, entry);
          engine.on("update", (msg: Exclude<EngineMessage, { type: "snapshot" }>) => {
            this.broadcast(newEntry, msg);
          });
        }
        // Shared across every subscriber to this symbol — a second subscriber arriving while
        // the engine is still starting awaits the SAME promise instead of reading an empty snapshot.
        await entry.startPromise;

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
          if (parsed.type === "subscribe" && isValidSymbol) {
            subscribeTo(parsed.symbol).catch((err) => console.error("subscribe failed:", err));
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
      ? JSON.stringify(this.toLegacyTickFromUpdate(entry, msg))
      : null;
    for (const client of entry.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(payload);
      if (legacyPayload) client.send(legacyPayload);
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

  private static toLegacyTickFromUpdate(
    entry: SymbolEntry,
    msg: Extract<EngineMessage, { type: "candle" } | { type: "book" }>
  ) {
    return this.toLegacyTick(entry.engine.getSnapshotMessage());
  }
}
