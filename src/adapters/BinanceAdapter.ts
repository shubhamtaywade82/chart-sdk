import type {
  IDataAdapter, Candle, OrderBookLevel, TickPayload,
  SymbolDef, IntervalDef, FundsSnapshot,
} from "./IDataAdapter";

// Binance Futures adapter — all data comes from the chart-sdk backend
// which proxies to the existing binance-charts server routes.
export class BinanceAdapter implements IDataAdapter {
  readonly id = "binance";
  readonly name = "Binance Futures";
  readonly currency = "$";
  readonly is24x7 = true;

  private wsRef: WebSocket | null = null;

  getSymbols(): SymbolDef[] {
    return [
      { key: "btcusdt",  label: "BTC/USDT",  precision: 2 },
      { key: "ethusdt",  label: "ETH/USDT",  precision: 2 },
      { key: "solusdt",  label: "SOL/USDT",  precision: 2 },
      { key: "bnbusdt",  label: "BNB/USDT",  precision: 2 },
      { key: "xrpusdt",  label: "XRP/USDT",  precision: 4 },
    ];
  }

  getIntervals(): IntervalDef[] {
    return [
      { key: "1",   label: "1m"  },
      { key: "3",   label: "3m"  },
      { key: "5",   label: "5m"  },
      { key: "15",  label: "15m" },
      { key: "30",  label: "30m" },
      { key: "60",  label: "1h"  },
      { key: "4h",  label: "4h"  },
      { key: "1d",  label: "1D"  },
    ];
  }

  async fetchCandles(symbol: string, interval: string, _limit = 500): Promise<Candle[]> {
    const res = await fetch(`/api/binance/charts/intraday?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`);
    const json = await res.json();
    return Array.isArray(json?.candles) ? json.candles : [];
  }

  async fetchHistoricalCandles(
    symbol: string, interval: string, fromTs: number, toTs: number
  ): Promise<Candle[]> {
    const from = new Date(fromTs * 1000).toISOString();
    const to   = new Date(toTs * 1000).toISOString();
    const res  = await fetch(
      `/api/binance/charts/historical?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&fromDate=${from}&toDate=${to}`
    );
    const json = await res.json();
    return Array.isArray(json?.candles) ? json.candles : [];
  }

  subscribeToTick(
    symbol: string,
    interval: string,
    onCandle: (c: Candle) => void,
    onTick: (t: TickPayload) => void
  ): () => void {
    // Close any existing connection
    if (this.wsRef) {
      try { this.wsRef.close(); } catch {}
      this.wsRef = null;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/binance/feed?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let retryCount = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      ws = new WebSocket(wsUrl);
      this.wsRef = ws;

      ws.onopen = () => {
        try {
          retryCount = 0;
          ws?.send(JSON.stringify({ type: "subscribe", symbol }));
        } catch {}
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.securityId && String(msg.securityId).toLowerCase() !== symbol.toLowerCase()) return;
          if (msg.type === "candle" && msg.candle) onCandle(msg.candle);
          if (msg.type === "tick") {
            const bid = msg.bids?.[0]?.price ?? msg.price ?? 0;
            const ask = msg.asks?.[0]?.price ?? msg.price ?? 0;
            onTick({
              price: msg.ltp ?? msg.price ?? 0,
              bid,
              ask,
              spread: Math.max(0, ask - bid),
              bidQty: msg.bids?.[0]?.quantity,
              askQty: msg.asks?.[0]?.quantity,
            });
          }
        } catch {}
      };

      const scheduleReconnect = () => {
        if (cancelled) return;
        const delay = Math.min(30000, 1000 * 2 ** retryCount);
        retryCount += 1;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, delay);
      };
      ws.onclose = scheduleReconnect;
      ws.onerror = scheduleReconnect;
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { ws?.close(); } catch {}
      if (this.wsRef === ws) {
        this.wsRef = null;
      }
    };
  }

  subscribeOrderBook(
    symbol: string,
    _depth: number,
    onUpdate: (bids: OrderBookLevel[], asks: OrderBookLevel[]) => void
  ): () => void {
    // The server embeds bids/asks in every tick message on the main feed socket.
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/binance/feed?symbol=${encodeURIComponent(symbol)}&interval=1`;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let retryCount = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        try {
          retryCount = 0;
          ws?.send(JSON.stringify({ type: "subscribe", symbol }));
        } catch {}
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.securityId && String(msg.securityId).toLowerCase() !== symbol.toLowerCase()) return;
          if (msg.type === "tick" && Array.isArray(msg.bids) && Array.isArray(msg.asks)) {
            const bids = msg.bids.map((b: any) => ({ price: b.price, qty: b.qty ?? b.quantity ?? 0, quantity: b.quantity ?? b.qty ?? 0, orders: b.orders }));
            const asks = msg.asks.map((a: any) => ({ price: a.price, qty: a.qty ?? a.quantity ?? 0, quantity: a.quantity ?? a.qty ?? 0, orders: a.orders }));
            onUpdate(bids, asks);
          }
        } catch {}
      };
      const scheduleReconnect = () => {
        if (cancelled) return;
        const delay = Math.min(30000, 1000 * 2 ** retryCount);
        retryCount += 1;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, delay);
      };
      ws.onclose = scheduleReconnect;
      ws.onerror = scheduleReconnect;
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { ws?.close(); } catch {}
    };
  }

  async fetchFunds(): Promise<FundsSnapshot> {
    const res  = await fetch("/api/binance/funds");
    const json = await res.json();
    return {
      equity:           json?.data?.totalWalletBalance     ?? 0,
      availableMargin:  json?.data?.availableBalance        ?? 0,
      usedMargin:       json?.data?.totalInitialMargin      ?? 0,
      currency:         "$",
    };
  }

  async fetchPositions(): Promise<any[]> {
    const res  = await fetch("/api/binance/positions");
    const json = await res.json();
    return json?.data ?? [];
  }

  async fetchOrders(): Promise<any[]> {
    const res  = await fetch("/api/binance/orders");
    const json = await res.json();
    return json?.data ?? [];
  }
}
