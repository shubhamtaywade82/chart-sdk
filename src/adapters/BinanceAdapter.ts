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

// Binance Futures adapter — connects to backend proxy with auto-fallback to direct Binance streams
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

  async fetchCandles(symbol: string, interval: string, limit = 500): Promise<Candle[]> {
    try {
      const res = await fetch(`/api/binance/charts/intraday?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.candles) && json.candles.length > 0) return json.candles;
      }
    } catch {}

    // Public Binance API fallback
    try {
      const normSym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const binanceSym = normSym.endsWith("USDT") ? normSym : `${normSym}USDT`;
      const binanceInterval = interval === "1D" || interval === "1d" ? "1d" : interval.endsWith("m") || interval.endsWith("h") ? interval : `${interval}m`;
      const direct = await fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${binanceInterval}&limit=${limit}`);
      if (direct.ok) {
        const raw = await direct.json();
        return raw.map((k: any) => ({
          time: Math.floor(k[0] / 1000),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));
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
      const res  = await fetch(
        `/api/binance/charts/historical?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&fromDate=${from}&toDate=${to}`
      );
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.candles) && json.candles.length > 0) return json.candles;
      }
    } catch {}

    return this.fetchCandles(symbol, interval, 500);
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

    const normSym = symbol.toLowerCase().replace(/[^a-z0-9]/g, "");
    const binanceSym = normSym.endsWith("usdt") ? normSym : `${normSym}usdt`;
    const binanceInterval = interval === "1D" || interval === "1d" ? "1d" : interval.endsWith("m") || interval.endsWith("h") ? interval : `${interval}m`;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const localWsUrl = `${protocol}//${host}/ws/binance/feed?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`;
    const publicWsUrl = `wss://stream.binance.com:9443/ws/${binanceSym}@ticker/${binanceSym}@kline_${binanceInterval}`;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let retryCount = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let usePublicFallback = false;

    const connect = () => {
      if (cancelled) return;
      const targetUrl = usePublicFallback ? publicWsUrl : localWsUrl;

      try {
        ws = new WebSocket(targetUrl);
        this.wsRef = ws;

        ws.onopen = () => {
          retryCount = 0;
          if (!usePublicFallback) {
            try { ws?.send(JSON.stringify({ type: "subscribe", symbol })); } catch {}
          }
        };

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            // Public Binance WebSocket Stream
            if (msg.e === "kline" && msg.k) {
              onCandle({
                time: Math.floor(msg.k.t / 1000),
                open: parseFloat(msg.k.o),
                high: parseFloat(msg.k.h),
                low: parseFloat(msg.k.l),
                close: parseFloat(msg.k.c),
                volume: parseFloat(msg.k.v),
              });
            } else if (msg.e === "24hrTicker") {
              const bid = parseFloat(msg.b || msg.c || 0);
              const ask = parseFloat(msg.a || msg.c || 0);
              const ltp = parseFloat(msg.c || 0);
              onTick({
                price: ltp,
                bid,
                ask,
                spread: Math.max(0, ask - bid),
                bidQty: parseFloat(msg.B || 0),
                askQty: parseFloat(msg.A || 0),
              });
            }

            // Local Backend Proxy Messages
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
          if (!usePublicFallback && retryCount >= 1) {
            usePublicFallback = true; // Switch to public Binance WebSocket if local proxy is offline
          }
          const delay = Math.min(10000, 1000 * 2 ** Math.min(3, retryCount));
          retryCount += 1;
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, delay);
        };

        ws.onclose = scheduleReconnect;
        ws.onerror = scheduleReconnect;
      } catch {
        usePublicFallback = true;
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
    const normSym = symbol.toLowerCase().replace(/[^a-z0-9]/g, "");
    const binanceSym = normSym.endsWith("usdt") ? normSym : `${normSym}usdt`;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const localWsUrl = `${protocol}//${host}/ws/binance/feed?symbol=${encodeURIComponent(symbol)}&interval=1`;
    const publicWsUrl = `wss://stream.binance.com:9443/ws/${binanceSym}@depth20@100ms`;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let retryCount = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let usePublicFallback = false;

    const connect = () => {
      if (cancelled) return;
      const targetUrl = usePublicFallback ? publicWsUrl : localWsUrl;

      try {
        ws = new WebSocket(targetUrl);

        ws.onopen = () => {
          retryCount = 0;
          if (!usePublicFallback) {
            try { ws?.send(JSON.stringify({ type: "subscribe", symbol })); } catch {}
          }
        };

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);

            // Public Binance depth stream
            if (Array.isArray(msg.bids) && Array.isArray(msg.asks)) {
              const bids: OrderBookLevel[] = msg.bids.map((b: any) => ({
                price: parseFloat(b[0] ?? b.price),
                quantity: parseFloat(b[1] ?? b.quantity ?? b.qty ?? 0),
                qty: parseFloat(b[1] ?? b.quantity ?? b.qty ?? 0),
              }));
              const asks: OrderBookLevel[] = msg.asks.map((a: any) => ({
                price: parseFloat(a[0] ?? a.price),
                quantity: parseFloat(a[1] ?? a.quantity ?? a.qty ?? 0),
                qty: parseFloat(a[1] ?? a.quantity ?? a.qty ?? 0),
              }));
              onUpdate(bids, asks);
              return;
            }

            // Local backend proxy message
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
          if (!usePublicFallback && retryCount >= 1) {
            usePublicFallback = true;
          }
          const delay = Math.min(10000, 1000 * 2 ** Math.min(3, retryCount));
          retryCount += 1;
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, delay);
        };

        ws.onclose = scheduleReconnect;
        ws.onerror = scheduleReconnect;
      } catch {
        usePublicFallback = true;
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
      const res = await fetch("/api/binance/funds");
      if (res.ok) {
        const json = await res.json();
        return {
          equity:          json?.data?.totalWalletBalance     ?? 100000,
          availableMargin: json?.data?.availableBalance        ?? 100000,
          usedMargin:      json?.data?.totalInitialMargin      ?? 0,
          currency:        "$",
        };
      }
    } catch {}

    return {
      equity: 100000,
      availableMargin: 100000,
      usedMargin: 0,
      currency: "$",
    };
  }

  async fetchPositions(): Promise<any[]> {
    try {
      const res = await fetch("/api/binance/positions");
      if (res.ok) {
        const json = await res.json();
        return json?.data ?? [];
      }
    } catch {}
    return [];
  }

  async fetchOrders(): Promise<any[]> {
    try {
      const res = await fetch("/api/binance/orders");
      if (res.ok) {
        const json = await res.json();
        return json?.data ?? [];
      }
    } catch {}
    return [];
  }
}
