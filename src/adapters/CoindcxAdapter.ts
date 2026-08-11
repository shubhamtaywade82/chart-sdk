import type {
  IDataAdapter, Candle, OrderBookLevel, TickPayload,
  SymbolDef, IntervalDef, FundsSnapshot,
} from "./IDataAdapter";

const safeCloseSocket = (socket: WebSocket | null) => {
  if (!socket) return;
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  try {
    if (socket.readyState === WebSocket.OPEN) {
      socket.close();
    } else if (socket.readyState === WebSocket.CONNECTING) {
      socket.onopen = () => {
        try { socket.close(); } catch {}
      };
    }
  } catch {}
};

// CoinDCX futures adapter — streams through the local /ws/coindcx feed, fetches via /api/coindcx
export class CoindcxAdapter implements IDataAdapter {
  readonly id = "coindcx";
  readonly name = "CoinDCX Futures (USDT-M)";
  readonly currency = "$";
  readonly is24x7 = true;

  private wsRef: WebSocket | null = null;

  getSymbols(): SymbolDef[] {
    return [
      { key: "btcusdt",  label: "BTC/USDT",  precision: 2 },
      { key: "ethusdt",  label: "ETH/USDT",  precision: 2 },
      { key: "solusdt",  label: "SOL/USDT",  precision: 4 },
      { key: "bnbusdt",  label: "BNB/USDT",  precision: 2 },
      { key: "xrpusdt",  label: "XRP/USDT",  precision: 4 },
      { key: "dogeusdt", label: "DOGE/USDT", precision: 5 },
    ];
  }

  getIntervals(): IntervalDef[] {
    return [
      { key: "1",   label: "1m"  },
      { key: "5",   label: "5m"  },
      { key: "15",  label: "15m" },
      { key: "30",  label: "30m" },
      { key: "60",  label: "1H"  },
      { key: "4h",  label: "4H"  },
      { key: "1d",  label: "1D"  },
    ];
  }

  async fetchCandles(symbol: string, interval: string, limit = 500): Promise<Candle[]> {
    try {
      const res = await fetch(
        `/api/coindcx/charts/intraday?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`
      );
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.candles) && json.candles.length > 0) return json.candles;
      }
    } catch {}
    return [];
  }

  async fetchHistoricalCandles(
    symbol: string, interval: string, fromTs: number, toTs: number
  ): Promise<Candle[]> {
    const from = new Date(fromTs * 1000).toISOString();
    const to   = new Date(toTs * 1000).toISOString();
    try {
      const res = await fetch(
        `/api/coindcx/charts/historical?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&fromDate=${from}&toDate=${to}`
      );
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.candles) && json.candles.length > 0) return json.candles;
      }
    } catch {}
    return [];
  }

  subscribeToTick(
    symbol: string,
    interval: string,
    onCandle: (c: Candle) => void,
    onTick: (t: TickPayload) => void
  ): () => void {
    if (this.wsRef) {
      safeCloseSocket(this.wsRef);
      this.wsRef = null;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const feedUrl = `${protocol}//${host}/ws/coindcx/feed`;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let retryCount = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      try {
        ws = new WebSocket(feedUrl);
        this.wsRef = ws;

        ws.onopen = () => {
          retryCount = 0;
          try { ws?.send(JSON.stringify({ type: "subscribe", symbol })); } catch {}
        };

        ws.onmessage = (e) => {
          if (cancelled) return;
          try {
            const msg = JSON.parse(e.data);
            if (msg.securityId && String(msg.securityId).toLowerCase() !== symbol.toLowerCase()) return;

            if (msg.type === "candle" && msg.candle) {
              onCandle({
                time: Math.floor(Number(msg.candle.time)),
                open: Number(msg.candle.open),
                high: Number(msg.candle.high),
                low: Number(msg.candle.low),
                close: Number(msg.candle.close),
                volume: Number(msg.candle.volume),
              });
            } else if (msg.type === "tick") {
              const bid = msg.bids?.[0]?.price ?? msg.ltp ?? 0;
              const ask = msg.asks?.[0]?.price ?? msg.ltp ?? 0;
              onTick({
                price: msg.ltp ?? 0,
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
          const delay = Math.min(10000, 1000 * 2 ** Math.min(3, retryCount));
          retryCount += 1;
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, delay);
        };

        ws.onclose = scheduleReconnect;
        ws.onerror = scheduleReconnect;
      } catch {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 2000);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      safeCloseSocket(ws);
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
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const feedUrl = `${protocol}//${host}/ws/coindcx/feed`;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let retryCount = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      try {
        ws = new WebSocket(feedUrl);

        ws.onopen = () => {
          retryCount = 0;
          try { ws?.send(JSON.stringify({ type: "subscribe", symbol })); } catch {}
        };

        ws.onmessage = (e) => {
          if (cancelled) return;
          try {
            const msg = JSON.parse(e.data);
            if (msg.securityId && String(msg.securityId).toLowerCase() !== symbol.toLowerCase()) return;
            if (msg.type === "tick" && Array.isArray(msg.bids) && Array.isArray(msg.asks)) {
              const toLevels = (rows: any[]): OrderBookLevel[] =>
                rows.slice(0, _depth).map((l: any) => ({
                  price: l.price,
                  qty: l.quantity ?? l.qty ?? 0,
                  quantity: l.quantity ?? l.qty ?? 0,
                  orders: 1,
                }));
              onUpdate(toLevels(msg.bids), toLevels(msg.asks));
            }
          } catch {}
        };

        const scheduleReconnect = () => {
          if (cancelled) return;
          const delay = Math.min(10000, 1000 * 2 ** Math.min(3, retryCount));
          retryCount += 1;
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, delay);
        };

        ws.onclose = scheduleReconnect;
        ws.onerror = scheduleReconnect;
      } catch {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 2000);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      safeCloseSocket(ws);
    };
  }

  async fetchFunds(): Promise<FundsSnapshot> {
    try {
      const res = await fetch("/api/coindcx/funds");
      if (res.ok) {
        const json = await res.json();
        const d = json?.data;
        if (d) {
          return {
            equity:          Number(d.equity ?? 0),
            availableMargin: Number(d.availMargin ?? 0),
            usedMargin:      Number(d.usedMargin ?? 0),
            currency:        d.currency ?? "$",
          };
        }
      }
    } catch {}
    return { equity: 0, availableMargin: 0, usedMargin: 0, currency: "$" };
  }

  async fetchPositions(): Promise<any[]> {
    try {
      const res = await fetch("/api/coindcx/positions");
      if (res.ok) {
        const json = await res.json();
        return Array.isArray(json?.data) ? json.data : [];
      }
    } catch {}
    return [];
  }

  async fetchOrders(): Promise<any[]> {
    try {
      const res = await fetch("/api/coindcx/orders");
      if (res.ok) {
        const json = await res.json();
        return Array.isArray(json?.data) ? json.data : [];
      }
    } catch {}
    return [];
  }
}
