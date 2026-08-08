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
    const res = await fetch(`/api/dhanhq/charts/intraday?symbol=${symbol}&interval=${interval}`);
    const json = await res.json();
    return Array.isArray(json?.candles) ? json.candles : [];
  }

  async fetchHistoricalCandles(
    symbol: string, interval: string, fromTs: number, toTs: number
  ): Promise<Candle[]> {
    const from = new Date(fromTs * 1000).toISOString();
    const to   = new Date(toTs * 1000).toISOString();
    const res  = await fetch(
      `/api/dhanhq/charts/historical?symbol=${symbol}&interval=${interval}&fromDate=${from}&toDate=${to}`
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
    const ws = new WebSocket(`/ws/dhanhq?symbol=${symbol}&interval=${interval}`);

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "candle" && msg.candle) onCandle(msg.candle);
        if (msg.type === "tick")   onTick({ price: msg.price, bid: msg.bid ?? msg.price, ask: msg.ask ?? msg.price, spread: msg.spread ?? 0 });
      } catch {}
    };

    return () => ws.close();
  }

  subscribeOrderBook(
    symbol: string,
    depth: number,
    onUpdate: (bids: OrderBookLevel[], asks: OrderBookLevel[]) => void
  ): () => void {
    const ws = new WebSocket(`/ws/dhanhq/depth?symbol=${symbol}&depth=${depth}`);
    ws.onmessage = (e) => {
      try {
        const { bids, asks } = JSON.parse(e.data);
        onUpdate(bids, asks);
      } catch {}
    };
    return () => ws.close();
  }

  async fetchFunds(): Promise<FundsSnapshot> {
    const res  = await fetch("/api/dhanhq/funds");
    const json = await res.json();
    return {
      equity:          json?.data?.availabelBalance ?? 0,
      availableMargin: json?.data?.availabelBalance ?? 0,
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
