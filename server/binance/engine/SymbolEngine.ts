import { EventEmitter } from "events";
import WebSocket from "ws";
import { DepthBook, DepthEvent } from "./depthSync";
import { computeCVD, computeImbalance, detectAbsorption, detectWalls } from "./derived";
import { fetchDepthSnapshot, fetchFundingAndOI, fetchKlines } from "./binanceRest";
import { AbsorptionEvent, EngineCandle, EngineMessage, EngineTrade, FundingInfo, LiquidationEvent, WallLevel } from "./types";

const WS_BASE = "wss://fstream.binance.com";
const KLINE_SEED_COUNT = 500;
const DEPTH_SNAPSHOT_LIMIT = 1000;
const DEPTH_BROADCAST_LEVELS = 50;
const TRADE_BUFFER_SIZE = 2000;
const LIQUIDATION_BUFFER_SIZE = 200;
const FUNDING_POLL_MS = 5_000;
const BOOK_TRADE_FLUSH_MS = 250;
const WALL_MIN_QTY = 5;
const WALL_PERSISTENCE_MS = 2_000;
const IMBALANCE_DEPTH_LEVELS = 20;
const ABSORPTION_MULTIPLIER = 1.5;
const ABSORPTION_WINDOW_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

type UpdateMessage = Exclude<EngineMessage, { type: "snapshot" }>;

export class SymbolEngine extends EventEmitter {
  private readonly symbol: string;
  private readonly interval: string;
  private candles: EngineCandle[] = [];
  private readonly book = new DepthBook();
  private trades: EngineTrade[] = [];
  private liquidations: LiquidationEvent[] = [];
  private funding: FundingInfo = { fundingRate: 0, openInterest: 0, nextFundingTime: 0 };

  private bidFirstSeen = new Map<number, number>();
  private askFirstSeen = new Map<number, number>();
  private prevBidPrices = new Set<number>();
  private prevAskPrices = new Set<number>();

  private depthEventBuffer: DepthEvent[] = [];
  private depthSnapshotLoaded = false;

  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private fundingTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  private pendingBookUpdate = false;
  private pendingTrades: EngineTrade[] = [];

  constructor(symbol: string, interval: string) {
    super();
    this.symbol = symbol.toLowerCase();
    this.interval = interval;
  }

  async start(): Promise<void> {
    this.destroyed = false;
    await this.seedKlines();
    await this.resyncDepth();
    this.connectStream();
    this.fundingTimer = setInterval(() => this.pollFunding(), FUNDING_POLL_MS);
    this.pollFunding();
    this.flushTimer = setInterval(() => this.flush(), BOOK_TRADE_FLUSH_MS);
  }

  stop(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.fundingTimer) clearInterval(this.fundingTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  getSnapshotMessage(): Extract<EngineMessage, { type: "snapshot" }> {
    const state = this.book.getState();
    const { walls, absorptions } = this.computeCurrentSignals();
    return {
      type: "snapshot",
      symbol: this.symbol,
      candles: this.candles,
      book: {
        bids: state.bids.slice(0, DEPTH_BROADCAST_LEVELS),
        asks: state.asks.slice(0, DEPTH_BROADCAST_LEVELS),
        lastUpdateId: state.lastUpdateId,
      },
      trades: this.trades.slice(0, 50),
      cvd: computeCVD(this.trades),
      walls,
      absorptions,
      imbalance: computeImbalance(state.bids, state.asks, IMBALANCE_DEPTH_LEVELS),
      funding: this.funding,
    };
  }

  private emitUpdate(msg: UpdateMessage) {
    this.emit("update", msg);
  }

  private async seedKlines(): Promise<void> {
    this.candles = await fetchKlines(this.symbol, this.interval, KLINE_SEED_COUNT);
  }

  private async resyncDepth(): Promise<void> {
    this.depthSnapshotLoaded = false;
    const snap = await fetchDepthSnapshot(this.symbol, DEPTH_SNAPSHOT_LIMIT);
    this.book.loadSnapshot(snap);
    this.depthSnapshotLoaded = true;
    this.prevBidPrices = new Set(snap.bids.map(([p]) => Number(p)));
    this.prevAskPrices = new Set(snap.asks.map(([p]) => Number(p)));
    const now = Date.now();
    this.bidFirstSeen = new Map([...this.prevBidPrices].map((p) => [p, now]));
    this.askFirstSeen = new Map([...this.prevAskPrices].map((p) => [p, now]));

    for (const evt of this.depthEventBuffer) this.applyDepthEvent(evt);
    this.depthEventBuffer = [];
  }

  private connectStream(): void {
    if (this.destroyed) return;
    const streams = [
      `${this.symbol}@kline_${this.interval}`,
      `${this.symbol}@aggTrade`,
      `${this.symbol}@depth@100ms`,
      `${this.symbol}@forceOrder`,
    ].join("/");
    const ws = new WebSocket(`${WS_BASE}/stream?streams=${streams}`);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempts = 0;
    });
    ws.on("message", (data) => this.handleMessage(data.toString()));
    ws.on("error", () => this.scheduleReconnect());
    ws.on("close", () => this.scheduleReconnect());
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.destroyed) return;
      await this.resyncDepth(); // reconnects always re-snapshot, per spec's resilience section
      this.connectStream();
    }, delay);
  }

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const stream: string = msg.stream || "";
    const d = msg.data;
    if (!d) return;

    if (stream.endsWith(`@kline_${this.interval}`)) this.handleKline(d);
    else if (stream.endsWith("@aggTrade")) this.handleTrade(d);
    else if (stream.endsWith("@depth@100ms")) this.handleDepthEvent(d);
    else if (stream.endsWith("@forceOrder")) this.handleLiquidation(d);
  }

  private handleKline(d: any): void {
    const k = d.k;
    if (!k) return;
    const candle: EngineCandle = {
      t: k.t,
      o: Number(k.o),
      h: Number(k.h),
      l: Number(k.l),
      c: Number(k.c),
      v: Number(k.v),
      bv: Number(k.V || 0),
    };
    const last = this.candles[this.candles.length - 1];
    if (last && last.t === candle.t) this.candles[this.candles.length - 1] = candle;
    else {
      this.candles.push(candle);
      if (this.candles.length > KLINE_SEED_COUNT) this.candles.shift();
    }
    this.emitUpdate({ type: "candle", symbol: this.symbol, candle });
  }

  private handleTrade(d: any): void {
    const trade: EngineTrade = {
      id: d.a,
      time: d.T,
      price: Number(d.p),
      qty: Number(d.q),
      isSell: Boolean(d.m),
      usd: Number(d.p) * Number(d.q),
    };
    this.trades.unshift(trade);
    if (this.trades.length > TRADE_BUFFER_SIZE) this.trades.length = TRADE_BUFFER_SIZE;
    this.pendingTrades.push(trade);
  }

  private handleDepthEvent(d: any): void {
    const evt: DepthEvent = { U: d.U, u: d.u, pu: d.pu, bids: d.b, asks: d.a };
    if (!this.depthSnapshotLoaded) {
      this.depthEventBuffer.push(evt);
      return;
    }
    this.applyDepthEvent(evt);
  }

  private applyDepthEvent(evt: DepthEvent): void {
    const result = this.book.applyEvent(evt);
    if (result === "gap") {
      this.resyncDepth();
      return;
    }
    if (result !== "applied") return;

    const now = Date.now();
    const state = this.book.getState();
    this.trackLevelAges(state.bids.map((l) => l.price), this.prevBidPrices, this.bidFirstSeen, now);
    this.trackLevelAges(state.asks.map((l) => l.price), this.prevAskPrices, this.askFirstSeen, now);
    this.pendingBookUpdate = true;
  }

  private trackLevelAges(
    currentPrices: number[],
    prevSet: Set<number>,
    firstSeen: Map<number, number>,
    now: number
  ): void {
    const currentSet = new Set(currentPrices);
    for (const price of currentSet) {
      if (!prevSet.has(price)) firstSeen.set(price, now);
    }
    for (const price of prevSet) {
      if (!currentSet.has(price)) firstSeen.delete(price);
    }
    prevSet.clear();
    for (const price of currentSet) prevSet.add(price);
  }

  private handleLiquidation(d: any): void {
    const o = d.o;
    if (!o) return;
    const liq: LiquidationEvent = {
      price: Number(o.p),
      qty: Number(o.q),
      side: o.S === "SELL" ? "sell" : "buy",
      time: o.T,
    };
    this.liquidations.unshift(liq);
    if (this.liquidations.length > LIQUIDATION_BUFFER_SIZE) this.liquidations.length = LIQUIDATION_BUFFER_SIZE;
    this.emitUpdate({ type: "liquidation", symbol: this.symbol, liq });
  }

  private async pollFunding(): Promise<void> {
    try {
      this.funding = await fetchFundingAndOI(this.symbol);
      this.emitUpdate({ type: "funding", symbol: this.symbol, funding: this.funding });
    } catch {
      // keep last-known value; retried on the next interval
    }
  }

  /** Walls, plus which of those walls show absorption right now — computed together since absorption is evaluated per-wall. */
  private computeCurrentSignals(): { walls: WallLevel[]; absorptions: AbsorptionEvent[] } {
    const state = this.book.getState();
    const now = Date.now();
    const wallOpts = { minQty: WALL_MIN_QTY, persistenceMs: WALL_PERSISTENCE_MS };
    const walls = [
      ...detectWalls(state.bids, "bid", this.bidFirstSeen, now, wallOpts),
      ...detectWalls(state.asks, "ask", this.askFirstSeen, now, wallOpts),
    ];

    const recentTrades = this.trades.filter((t) => now - t.time <= ABSORPTION_WINDOW_MS);
    const absorptions: AbsorptionEvent[] = walls
      .filter((wall) => detectAbsorption(wall, recentTrades, { absorptionMultiplier: ABSORPTION_MULTIPLIER }))
      .map((wall) => ({ price: wall.price, side: wall.side, qty: wall.qty, detectedAt: now }));

    return { walls, absorptions };
  }

  private flush(): void {
    if (this.pendingBookUpdate) {
      this.pendingBookUpdate = false;
      const state = this.book.getState();
      const { walls, absorptions } = this.computeCurrentSignals();
      this.emitUpdate({
        type: "book",
        symbol: this.symbol,
        bids: state.bids.slice(0, DEPTH_BROADCAST_LEVELS),
        asks: state.asks.slice(0, DEPTH_BROADCAST_LEVELS),
        walls,
        absorptions,
        imbalance: computeImbalance(state.bids, state.asks, IMBALANCE_DEPTH_LEVELS),
      });
    }
    if (this.pendingTrades.length > 0) {
      const cvd = computeCVD(this.trades);
      for (const trade of this.pendingTrades) {
        this.emitUpdate({ type: "trade", symbol: this.symbol, trade, cvd });
      }
      this.pendingTrades = [];
    }
  }
}
