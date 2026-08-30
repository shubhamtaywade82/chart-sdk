import { WebSocketServer, WebSocket } from "ws";
import { SymbolEngine } from "./engine/SymbolEngine";
import { EngineMessage } from "./engine/types";

const DEFAULT_INTERVAL = "1m";

interface SymbolEntry {
  engine: SymbolEngine;
  subscriberCount: number;
  clients: Set<WebSocket>;
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
          entry.clients.delete(ws);
          entry.subscriberCount--;
          if (entry.subscriberCount <= 0) {
            entry.engine.stop();
            this.engines.delete(currentSymbol);
            console.log(`🧹 stopped engine for idle symbol: ${currentSymbol}`);
          }
        }
        currentSymbol = null;
      };

      const subscribeTo = async (symbolRaw: string) => {
        unsubscribeCurrent();
        const symbol = symbolRaw.toLowerCase();
        currentSymbol = symbol;

        let entry = this.engines.get(symbol);
        if (!entry) {
          const engine = new SymbolEngine(symbol, DEFAULT_INTERVAL);
          entry = { engine, subscriberCount: 0, clients: new Set() };
          this.engines.set(symbol, entry);
          engine.on("update", (msg: Exclude<EngineMessage, { type: "snapshot" }>) => {
            this.broadcast(entry!, msg);
          });
          await engine.start();
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
          if (parsed.type === "subscribe" && parsed.symbol) {
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
    const ltp = last?.c ?? 0;
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
