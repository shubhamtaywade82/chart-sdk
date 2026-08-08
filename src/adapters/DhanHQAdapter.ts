import type {
  IDataAdapter, Candle, OrderBookLevel, TickPayload,
  SymbolDef, IntervalDef, FundsSnapshot,
} from "./IDataAdapter";

// DhanHQ adapter — NSE/BSE markets (equity + F&O).
// Calls the chart-sdk backend which proxies to the existing dhanhq-charts server.
export class DhanHQAdapter implements IDataAdapter {
  readonly id = "dhanhq";
  readonly name = "DhanHQ NSE";
  readonly currency = "₹";
  readonly is24x7 = false; // NSE: Mon–Fri 09:15–15:30 IST

  getSymbols(): SymbolDef[] {
    return [
      { key: "nifty",     label: "NIFTY 50",    precision: 2 },
      { key: "banknifty", label: "BANK NIFTY",   precision: 2 },
      { key: "sensex",    label: "SENSEX",        precision: 2 },
      { key: "reliance",  label: "RELIANCE",      precision: 2 },
      { key: "hdfcbank",  label: "HDFC BANK",     precision: 2 },
      { key: "tcs",       label: "TCS",           precision: 2 },
      { key: "infy",      label: "INFOSYS",       precision: 2 },
    ];
  }

  getIntervals(): IntervalDef[] {
    return [
      { key: "1",  label: "1m"  },
      { key: "5",  label: "5m"  },
      { key: "15", label: "15m" },
      { key: "30", label: "30m" },
      { key: "60", label: "1h"  },
    ];
  }

  async fetchCandles(symbol: string, interval: string, _limit = 500): Promise<Candle[]> {
    const res = await fetch(`/api/dhanhq/charts/intraday?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`);
    const json = await res.json();
    return Array.isArray(json?.candles) ? json.candles : [];
  }

  async fetchHistoricalCandles(
    symbol: string, interval: string, fromTs: number, toTs: number
  ): Promise<Candle[]> {
    const from = new Date(fromTs * 1000).toISOString();
    const to   = new Date(toTs * 1000).toISOString();
    const res  = await fetch(
      `/api/dhanhq/charts/historical?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`
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
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/dhanhq/feed?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ type: "subscribe", symbol }));
      } catch {}
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "candle" && msg.candle) onCandle(msg.candle);
        if (msg.type === "tick") {
          onTick({
            price: msg.price,
            bid: msg.bid ?? msg.price,
            ask: msg.ask ?? msg.price,
            spread: msg.spread ?? 0,
          });
        }
      } catch {}
    };

    return () => {
      try { ws.close(); } catch {}
    };
  }

  subscribeOrderBook(
    symbol: string,
    depth: number,
    onUpdate: (bids: OrderBookLevel[], asks: OrderBookLevel[]) => void
  ): () => void {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/dhanhq/feed?symbol=${encodeURIComponent(symbol)}&depth=${depth}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ type: "subscribe", symbol }));
      } catch {}
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "tick" && Array.isArray(msg.bids) && Array.isArray(msg.asks)) {
          // Normalize quantity to qty for OrderBookLevel interface
          const bids = msg.bids.map((b: any) => ({ price: b.price, qty: b.qty ?? b.quantity ?? 0, quantity: b.quantity ?? b.qty ?? 0, orders: b.orders }));
          const asks = msg.asks.map((a: any) => ({ price: a.price, qty: a.qty ?? a.quantity ?? 0, quantity: a.quantity ?? a.qty ?? 0, orders: a.orders }));
          onUpdate(bids, asks);
        }
      } catch {}
    };
    return () => {
      try { ws.close(); } catch {}
    };
  }

  async fetchFunds(): Promise<FundsSnapshot> {
    const res  = await fetch("/api/dhanhq/funds");
    const json = await res.json();
    const balance = json?.data?.availableBalance ?? json?.data?.availabelBalance ?? 0;
    return {
      equity:          balance,
      availableMargin: balance,
      usedMargin:      json?.data?.utilizedAmount   ?? 0,
      currency:        "₹",
    };
  }

  async fetchPositions(): Promise<any[]> {
    const res  = await fetch("/api/dhanhq/positions");
    const json = await res.json();
    return json?.data ?? [];
  }

  async fetchOrders(): Promise<any[]> {
    const res  = await fetch("/api/dhanhq/orders");
    const json = await res.json();
    return json?.data ?? [];
  }
}
