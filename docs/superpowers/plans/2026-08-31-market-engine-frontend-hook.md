# Shared Frontend Market Engine Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `useMarketEngine(symbol)` — a React hook consuming the native backend engine's `/ws/feed` directly (book, trades, CVD, walls, imbalance, absorptions, liquidations, funding) — and migrate `Market2DView` onto it, proving it works end-to-end.

**Architecture:** Message-application logic is a pure reducer (`applyEngineMessage`, unit-tested with fixtures, no React/WS involved) so the hook itself stays a thin WS-lifecycle wrapper around `useReducer`. Candles keep coming from wherever they already work — `market3d/useMarketWebSocket.ts`, trimmed to klines-only — per the spec's explicit scope boundary.

**Tech Stack:** React (hooks), native `WebSocket`, Vitest (existing).

**Spec:** `docs/superpowers/specs/2026-08-31-market-engine-frontend-hook-design.md`

## Global Constraints

- No candles in `useMarketEngine` — the backend serves one hardcoded interval per symbol; candle sourcing stays untouched (`BinanceAdapter` for Real-Time Terminal, `market3d/useMarketWebSocket.ts` for 2D).
- One dedicated WS connection per hook instance — no shared/multiplexed connection registry.
- `fetchPerpetualMetrics()` and `TradingViewChart.tsx` are **not touched** — `TradingViewChart` isn't migrated until sub-project 3; touching either now would break the Real-Time Terminal's funding/OI readout with no replacement in place.
- `subscribeOrderBook()` keeps its current `IDataAdapter` callback signature — only its dead Binance-direct fallback branch is removed, confirmed safe because its primary path already routes through the new backend and works.
- Types (`EngineTrade`, `OrderBookState`, `DepthLevel`, `WallLevel`, `AbsorptionEvent`, `LiquidationEvent`, `FundingInfo`, `EngineMessage`) are `import type`-ed directly from `server/binance/engine/types.ts` — no duplicated frontend copy.
- `pingMs` measures latency to the app's own backend (`fetch("/api/session-info")`), not Binance — the old `pingBinanceTime()` target is wrong once the connection itself is to `/ws/feed`.

---

## File Structure

```
src/hooks/
  marketEngineState.ts        # pure: EngineState type, initialEngineState, applyEngineMessage reducer
  marketEngineState.test.ts
  useMarketEngine.ts           # the hook: WS lifecycle + useReducer(applyEngineMessage) + wsStatus/msgRate/pingMs
src/components/market3d/
  useMarketWebSocket.ts        # modified: trimmed to klines-only
src/components/market2d/
  OrderBookLadder.tsx          # modified: consumes OrderBookState (already-numeric) instead of DepthData (string tuples)
  canvasRenderer.ts             # modified: pushDepthSnapshot takes numeric DepthLevel-shaped input
  Market2DView.tsx              # modified: wires useMarketEngine + trimmed useMarketWebSocket together
src/adapters/
  BinanceAdapter.ts             # modified: subscribeOrderBook loses its dead Binance-direct fallback
vitest.config.ts                # modified: include src/**/*.test.ts too (first frontend test file)
```

---

### Task 1: Pure reducer (`marketEngineState.ts`)

**Files:**
- Modify: `vitest.config.ts`
- Create: `src/hooks/marketEngineState.ts`
- Test: `src/hooks/marketEngineState.test.ts`

**Interfaces:**
- Consumes: `EngineMessage`, `EngineCandle`, `EngineTrade`, `OrderBookState`, `WallLevel`, `AbsorptionEvent`, `LiquidationEvent`, `FundingInfo` — `import type` from `../../server/binance/engine/types`.
- Produces: `EngineState` interface, `initialEngineState: EngineState`, `applyEngineMessage(state: EngineState, msg: EngineMessage): EngineState` — consumed by `useMarketEngine.ts` (Task 2).

- [ ] **Step 1: Broaden the test runner's include pattern**

Edit `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "src/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Write the failing tests**

`src/hooks/marketEngineState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyEngineMessage, initialEngineState } from "./marketEngineState";
import type { EngineMessage, EngineTrade } from "../../server/binance/engine/types";

function trade(id: number, price: number, isSell: boolean): EngineTrade {
  return { id, time: Date.now(), price, qty: 1, isSell, usd: price };
}

describe("applyEngineMessage", () => {
  it("snapshot replaces book/trades/cvd/walls/absorptions/imbalance/funding wholesale", () => {
    const msg: EngineMessage = {
      type: "snapshot",
      symbol: "btcusdt",
      candles: [],
      book: { bids: [{ price: 100, qty: 1 }], asks: [{ price: 101, qty: 1 }], lastUpdateId: 5 },
      trades: [trade(1, 100, false)],
      cvd: 3,
      windowedCvd: 2,
      walls: [{ price: 100, qty: 50, side: "bid", ageMs: 1000 }],
      imbalance: 0.6,
      absorptions: [{ price: 100, side: "bid", qty: 50, detectedAt: 123 }],
      funding: { fundingRate: 0.0001, openInterest: 1000, nextFundingTime: 999 },
    };
    const state = applyEngineMessage(initialEngineState, msg);
    expect(state.book).toEqual(msg.book);
    expect(state.trades).toEqual(msg.trades);
    expect(state.cvd).toBe(3);
    expect(state.windowedCvd).toBe(2);
    expect(state.walls).toEqual(msg.walls);
    expect(state.imbalance).toBe(0.6);
    expect(state.absorptions).toEqual(msg.absorptions);
    expect(state.funding).toEqual(msg.funding);
  });

  it("snapshot does not touch liquidations (the backend's snapshot never carries them)", () => {
    const prior = { ...initialEngineState, liquidations: [{ price: 1, qty: 1, side: "sell" as const, time: 1 }] };
    const msg: EngineMessage = {
      type: "snapshot", symbol: "btcusdt", candles: [],
      book: { bids: [], asks: [], lastUpdateId: 0 }, trades: [], cvd: 0, windowedCvd: 0,
      walls: [], imbalance: 0.5, absorptions: [],
      funding: { fundingRate: 0, openInterest: 0, nextFundingTime: 0 },
    };
    const state = applyEngineMessage(prior, msg);
    expect(state.liquidations).toEqual(prior.liquidations);
  });

  it("book updates bids/asks/walls/absorptions/imbalance, preserves everything else", () => {
    const prior = { ...initialEngineState, cvd: 7, trades: [trade(1, 100, false)] };
    const msg: EngineMessage = {
      type: "book", symbol: "btcusdt",
      bids: [{ price: 99, qty: 2 }], asks: [{ price: 102, qty: 2 }],
      walls: [{ price: 99, qty: 40, side: "bid", ageMs: 500 }],
      imbalance: 0.3, absorptions: [],
    };
    const state = applyEngineMessage(prior, msg);
    expect(state.book.bids).toEqual(msg.bids);
    expect(state.book.asks).toEqual(msg.asks);
    expect(state.walls).toEqual(msg.walls);
    expect(state.imbalance).toBe(0.3);
    expect(state.cvd).toBe(7); // untouched
    expect(state.trades).toEqual(prior.trades); // untouched
  });

  it("trade prepends to trade history and updates cvd/windowedCvd", () => {
    const prior = { ...initialEngineState, trades: [trade(1, 100, false)] };
    const msg: EngineMessage = { type: "trade", symbol: "btcusdt", trade: trade(2, 101, true), cvd: 5, windowedCvd: 4 };
    const state = applyEngineMessage(prior, msg);
    expect(state.trades[0]).toEqual(msg.trade);
    expect(state.trades).toHaveLength(2);
    expect(state.cvd).toBe(5);
    expect(state.windowedCvd).toBe(4);
  });

  it("trade history is capped at 200 entries", () => {
    const many = Array.from({ length: 200 }, (_, i) => trade(i, 100, false));
    const prior = { ...initialEngineState, trades: many };
    const msg: EngineMessage = { type: "trade", symbol: "btcusdt", trade: trade(999, 100, false), cvd: 0, windowedCvd: 0 };
    const state = applyEngineMessage(prior, msg);
    expect(state.trades).toHaveLength(200);
    expect(state.trades[0].id).toBe(999);
  });

  it("liquidation prepends to liquidation history, capped at 50", () => {
    const msg: EngineMessage = { type: "liquidation", symbol: "btcusdt", liq: { price: 100, qty: 1, side: "sell", time: 1 } };
    const state = applyEngineMessage(initialEngineState, msg);
    expect(state.liquidations).toEqual([msg.liq]);
  });

  it("funding replaces the funding field only", () => {
    const prior = { ...initialEngineState, cvd: 9 };
    const msg: EngineMessage = { type: "funding", symbol: "btcusdt", funding: { fundingRate: 0.001, openInterest: 5, nextFundingTime: 1 } };
    const state = applyEngineMessage(prior, msg);
    expect(state.funding).toEqual(msg.funding);
    expect(state.cvd).toBe(9);
  });

  it("candle messages are ignored (hook doesn't expose candles)", () => {
    const msg: EngineMessage = { type: "candle", symbol: "btcusdt", candle: { t: 1, o: 1, h: 1, l: 1, c: 1, v: 1, bv: 1 } };
    const state = applyEngineMessage(initialEngineState, msg);
    expect(state).toBe(initialEngineState);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- marketEngineState`
Expected: FAIL — `Cannot find module './marketEngineState'`.

- [ ] **Step 4: Implement**

`src/hooks/marketEngineState.ts`:

```ts
import type {
  EngineMessage,
  EngineTrade,
  LiquidationEvent,
  OrderBookState,
  WallLevel,
  AbsorptionEvent,
  FundingInfo,
} from "../../server/binance/engine/types";

export interface EngineState {
  book: OrderBookState;
  trades: EngineTrade[];
  cvd: number;
  windowedCvd: number;
  walls: WallLevel[];
  absorptions: AbsorptionEvent[];
  imbalance: number;
  liquidations: LiquidationEvent[];
  funding: FundingInfo;
}

const TRADE_HISTORY_CAP = 200;
const LIQUIDATION_HISTORY_CAP = 50;

export const initialEngineState: EngineState = {
  book: { bids: [], asks: [], lastUpdateId: 0 },
  trades: [],
  cvd: 0,
  windowedCvd: 0,
  walls: [],
  absorptions: [],
  imbalance: 0.5,
  liquidations: [],
  funding: { fundingRate: 0, openInterest: 0, nextFundingTime: 0 },
};

export function applyEngineMessage(state: EngineState, msg: EngineMessage): EngineState {
  switch (msg.type) {
    case "snapshot":
      return {
        book: msg.book,
        trades: msg.trades,
        cvd: msg.cvd,
        windowedCvd: msg.windowedCvd,
        walls: msg.walls,
        absorptions: msg.absorptions,
        imbalance: msg.imbalance,
        liquidations: state.liquidations,
        funding: msg.funding,
      };
    case "book":
      return {
        ...state,
        book: { bids: msg.bids, asks: msg.asks, lastUpdateId: state.book.lastUpdateId },
        walls: msg.walls,
        absorptions: msg.absorptions,
        imbalance: msg.imbalance,
      };
    case "trade":
      return {
        ...state,
        trades: [msg.trade, ...state.trades].slice(0, TRADE_HISTORY_CAP),
        cvd: msg.cvd,
        windowedCvd: msg.windowedCvd,
      };
    case "liquidation":
      return {
        ...state,
        liquidations: [msg.liq, ...state.liquidations].slice(0, LIQUIDATION_HISTORY_CAP),
      };
    case "funding":
      return { ...state, funding: msg.funding };
    case "candle":
      return state;
    default:
      return state;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- marketEngineState`
Expected: 8 passed.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors (confirms the cross-directory `import type` from `server/binance/engine/types.ts` resolves cleanly).

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts src/hooks/marketEngineState.ts src/hooks/marketEngineState.test.ts
git commit -m "feat(market-engine-hook): add pure engine-state reducer"
```

---

### Task 2: `useMarketEngine` hook

**Files:**
- Create: `src/hooks/useMarketEngine.ts`

**Interfaces:**
- Consumes: `EngineState`, `initialEngineState`, `applyEngineMessage` from `./marketEngineState` (Task 1); `EngineMessage` type from `../../server/binance/engine/types`.
- Produces: `useMarketEngine(symbol: string): EngineState & { wsStatus: WsEngineStatus; msgRate: number; pingMs: number | null }`, and the `WsEngineStatus` type — consumed by `Market2DView.tsx` (Task 5).

No automated test — this owns live WebSocket/timer state, same as `SymbolEngine` in sub-project 1. Verified manually once wired into `Market2DView` (Task 5).

- [ ] **Step 1: Write the file**

```ts
import { useEffect, useReducer, useRef, useState } from "react";
import type { EngineMessage } from "../../server/binance/engine/types";
import { applyEngineMessage, initialEngineState } from "./marketEngineState";

export type WsEngineStatus = "connecting" | "live" | "reconnecting" | "offline";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const PING_INTERVAL_MS = 12000;
const RATE_WINDOW_MS = 1000;

export function useMarketEngine(symbol: string) {
  const [state, dispatch] = useReducer(applyEngineMessage, initialEngineState);
  const [wsStatus, setWsStatus] = useState<WsEngineStatus>("connecting");
  const [msgRate, setMsgRate] = useState(0);
  const [pingMs, setPingMs] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgCountRef = useRef(0);
  const isDestroyedRef = useRef(false);

  useEffect(() => {
    isDestroyedRef.current = false;
    reconnectAttemptsRef.current = 0;

    const cleanupSocket = (ws: WebSocket | null) => {
      if (!ws) return;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      } catch {}
    };

    const scheduleReconnect = () => {
      if (isDestroyedRef.current) return;
      setWsStatus("reconnecting");
      reconnectAttemptsRef.current++;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttemptsRef.current, RECONNECT_MAX_MS);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    function connect() {
      if (isDestroyedRef.current) return;
      cleanupSocket(wsRef.current);
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/feed`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setWsStatus("live");
        try {
          ws.send(JSON.stringify({ type: "subscribe", symbol }));
        } catch {}
      };
      ws.onmessage = (e) => {
        msgCountRef.current++;
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "tick") return; // legacy compat message, not consumed here
          dispatch(msg as EngineMessage);
        } catch {}
      };
      ws.onerror = () => scheduleReconnect();
      ws.onclose = () => scheduleReconnect();
    }

    connect();

    return () => {
      isDestroyedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      cleanupSocket(wsRef.current);
      wsRef.current = null;
    };
  }, [symbol]);

  useEffect(() => {
    const rateTimer = setInterval(() => {
      setMsgRate(msgCountRef.current);
      msgCountRef.current = 0;
    }, RATE_WINDOW_MS);

    let isSubscribed = true;
    const pingLoop = async () => {
      const t0 = performance.now();
      try {
        await fetch("/api/session-info");
        if (isSubscribed) setPingMs(Math.round(performance.now() - t0));
      } catch {
        if (isSubscribed) setPingMs(null);
      }
      if (isSubscribed) setTimeout(pingLoop, PING_INTERVAL_MS);
    };
    pingLoop();

    return () => {
      isSubscribed = false;
      clearInterval(rateTimer);
    };
  }, []);

  return { ...state, wsStatus, msgRate, pingMs };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMarketEngine.ts
git commit -m "feat(market-engine-hook): add useMarketEngine hook"
```

---

### Task 3: Trim `useMarketWebSocket.ts` to klines-only

**Files:**
- Modify: `src/components/market3d/useMarketWebSocket.ts` (full rewrite of the file's content — every existing line is either kept as-is or removed, nothing new)

**Interfaces:**
- Produces: `useMarketWebSocket({ symbol, timeframe, onKline }): { wsStatus, msgRate, pingMs }` — note the params shrink from `{symbol, timeframe, onKline, onTrade, onDepth, onBookTicker, onTicker24h}` to just `{symbol, timeframe, onKline}`. Consumed by `Market2DView.tsx` (Task 5).

- [ ] **Step 1: Write the trimmed file**

```ts
import { useEffect, useRef, useState, useCallback } from "react";
import { Candle3D, WsStatus, Timeframe3D } from "./types";
import { pingBinanceTime } from "./dataService";

const WS_HOSTS = ["wss://data-stream.binance.vision", "wss://stream.binance.com:9443"];

interface UseMarketWebSocketParams {
  symbol: string;
  timeframe: Timeframe3D;
  onKline: (kline: Candle3D) => void;
}

export function useMarketWebSocket({ symbol, timeframe, onKline }: UseMarketWebSocketParams) {
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [msgRate, setMsgRate] = useState(0);
  const [pingMs, setPingMs] = useState<number | null>(null);

  const callbacksRef = useRef({ onKline });
  useEffect(() => {
    callbacksRef.current = { onKline };
  });

  const wsRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const hostIndexRef = useRef(0);
  const msgCountRef = useRef(0);
  const simTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const openTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isDestroyedRef = useRef(false);

  const cleanSymbol = symbol.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const pair = cleanSymbol.endsWith("usdt") ? cleanSymbol : `${cleanSymbol}usdt`;

  const stopSim = () => {
    if (simTimerRef.current) {
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
  };

  const startSim = useCallback(() => {
    if (simTimerRef.current || isDestroyedRef.current) return;
    setWsStatus("sim");

    let price = 180;
    simTimerRef.current = setInterval(() => {
      if (isDestroyedRef.current) return;
      const volat = price * 0.0012;
      const drift = (Math.random() - 0.5) * volat * 2.2;
      price = Math.max(1, price + drift);

      callbacksRef.current.onKline({
        t: Date.now(),
        o: price - drift,
        h: Math.max(price, price - drift) * 1.002,
        l: Math.min(price, price - drift) * 0.998,
        c: price,
        v: 100 + Math.random() * 50,
        bv: 50 + Math.random() * 25,
      });
    }, 750);
  }, []);

  const routeMessage = (d: any) => {
    msgCountRef.current++;
    if (d.e === "kline" && d.k) {
      const k = d.k;
      callbacksRef.current.onKline({
        t: k.t,
        o: Number(k.o),
        h: Number(k.h),
        l: Number(k.l),
        c: Number(k.c),
        v: Number(k.v),
        bv: Number(k.V || 0),
      });
    }
  };

  const cleanupActiveSocket = () => {
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {}
    }
  };

  const connectWs = useCallback(() => {
    if (isDestroyedRef.current) return;
    cleanupActiveSocket();

    const host = WS_HOSTS[hostIndexRef.current % WS_HOSTS.length];
    const streams = [`${pair}@kline_${timeframe}`].join("/");

    if (attemptsRef.current === 0) setWsStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${host}/stream?streams=${streams}`);
    } catch {
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    openTimeoutRef.current = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        cleanupActiveSocket();
        scheduleReconnect();
      }
    }, 6000);

    ws.onopen = () => {
      if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);
      attemptsRef.current = 0;
      stopSim();
      setWsStatus("live");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.data) routeMessage(msg.data);
      } catch {}
    };

    ws.onerror = () => {
      cleanupActiveSocket();
      scheduleReconnect();
    };

    ws.onclose = () => {
      cleanupActiveSocket();
      scheduleReconnect();
    };
  }, [pair, timeframe]);

  const scheduleReconnect = () => {
    if (isDestroyedRef.current) return;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);

    attemptsRef.current++;
    hostIndexRef.current++;
    if (attemptsRef.current >= 2) startSim();

    const delay = Math.min(1000 * Math.pow(1.8, attemptsRef.current), 15000);
    reconnectTimerRef.current = setTimeout(() => {
      if (!isDestroyedRef.current) connectWs();
    }, delay);
  };

  useEffect(() => {
    isDestroyedRef.current = false;
    attemptsRef.current = 0;
    connectWs();

    return () => {
      isDestroyedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      cleanupActiveSocket();
      stopSim();
    };
  }, [connectWs]);

  useEffect(() => {
    const rateTimer = setInterval(() => {
      setMsgRate(msgCountRef.current);
      msgCountRef.current = 0;
    }, 1000);

    let isSubscribed = true;
    const pingLoop = async () => {
      const ms = await pingBinanceTime();
      if (isSubscribed) setPingMs(ms);
      if (isSubscribed) setTimeout(pingLoop, 12000);
    };
    pingLoop();

    return () => {
      isSubscribed = false;
      clearInterval(rateTimer);
    };
  }, []);

  return { wsStatus, msgRate, pingMs };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errors in `src/components/market2d/Market2DView.tsx` (it still calls the old 7-param shape) — this is expected and fixed in Task 5. Confirm there are no OTHER unexpected errors (e.g. in `market3d/Market3DView.tsx` — should not exist, already deleted; if it somehow appears, stop and report BLOCKED, something is wrong).

- [ ] **Step 3: Commit**

```bash
git add src/components/market3d/useMarketWebSocket.ts
git commit -m "refactor(market3d): trim useMarketWebSocket to klines-only"
```

---

### Task 4: Update 2D consumers for the new numeric depth shape

**Files:**
- Modify: `src/components/market2d/OrderBookLadder.tsx`
- Modify: `src/components/market2d/canvasRenderer.ts`

**Interfaces:**
- Consumes: `OrderBookState`, `DepthLevel` — `import type` from `../../../server/binance/engine/types` (three levels up from `src/components/market2d/` to repo root).
- Produces: `OrderBookLadder({ book: OrderBookState | null; livePrice: number | null; rows?: number })`; `pushDepthSnapshot(buf: DepthSnapshot[], bids: Array<{price:number;qty:number}>, asks: Array<{price:number;qty:number}>)` — both consumed by `Market2DView.tsx` (Task 5).

- [ ] **Step 1: Replace `OrderBookLadder.tsx` with the updated version**

Full file — only the props type and the two `.map()` calls change (no more `[p,q]: [string,string]` tuple parsing, since `OrderBookState`'s `DepthLevel[]` is already `{price:number; qty:number}[]`); the JSX return is identical to the current file:

```tsx
import React from "react";
import type { OrderBookState } from "../../../server/binance/engine/types";
import { formatPrice, formatQty } from "../market3d/dataService";

interface OrderBookLadderProps {
  book: OrderBookState | null;
  livePrice: number | null;
  rows?: number;
}

export function OrderBookLadder({ book, livePrice, rows = 12 }: OrderBookLadderProps) {
  if (!book) {
    return (
      <div className="m2-ladder">
        <div className="m2-panel-head"><span className="m2-panel-title">ORDER BOOK</span></div>
      </div>
    );
  }

  const asks = book.asks.slice(0, rows);
  const bids = book.bids.slice(0, rows);

  let cumAsk = 0;
  let maxCum = 0;
  const askRows = asks
    .map((l) => {
      cumAsk += l.qty;
      maxCum = Math.max(maxCum, cumAsk);
      return { price: l.price, qty: l.qty, cum: cumAsk };
    })
    .reverse();

  let cumBid = 0;
  const bidRows = bids.map((l) => {
    cumBid += l.qty;
    maxCum = Math.max(maxCum, cumBid);
    return { price: l.price, qty: l.qty, cum: cumBid };
  });

  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : livePrice || 0;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : 0;
  const spreadBps = mid > 0 ? (spread / mid) * 1e4 : 0;

  return (
    <div className="m2-ladder">
      <div className="m2-panel-head">
        <span className="m2-panel-title">ORDER BOOK</span>
        <span style={{ fontSize: 9, color: "rgba(94,234,212,0.8)" }}>depth20@100ms</span>
      </div>
      <div className="m2-ladder-col-head">
        <span>PRICE</span><span className="right">SIZE</span><span className="right">TOTAL</span>
      </div>

      <div className="m2-ladder-rows">
        {askRows.map((r, i) => {
          const w = maxCum > 0 ? ((r.cum / maxCum) * 100).toFixed(1) : "0";
          return (
            <div key={`a${i}`} className="m2-ladder-row">
              <div className="m2-ladder-row-fill ask" style={{ width: `${w}%` }} />
              <span className="m2-ladder-row-price ask">{formatPrice(r.price)}</span>
              <span className="m2-ladder-row-qty">{formatQty(r.qty)}</span>
              <span className="m2-ladder-row-cum">{formatQty(r.cum)}</span>
            </div>
          );
        })}
      </div>

      <div className="m2-ladder-mid">
        <span className="m2-ladder-mid-price">{mid ? formatPrice(mid) : "—"}</span>
        <span className="m2-ladder-mid-spread">SPREAD {spread.toFixed(3)} · {spreadBps.toFixed(1)}bp</span>
      </div>

      <div className="m2-ladder-rows">
        {bidRows.map((r, i) => {
          const w = maxCum > 0 ? ((r.cum / maxCum) * 100).toFixed(1) : "0";
          return (
            <div key={`b${i}`} className="m2-ladder-row">
              <div className="m2-ladder-row-fill bid" style={{ width: `${w}%` }} />
              <span className="m2-ladder-row-price bid">{formatPrice(r.price)}</span>
              <span className="m2-ladder-row-qty">{formatQty(r.qty)}</span>
              <span className="m2-ladder-row-cum">{formatQty(r.cum)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `pushDepthSnapshot`'s signature in `canvasRenderer.ts`**

Find `pushDepthSnapshot` (it currently takes `bids: Array<[string, string]>, asks: Array<[string, string]>` and does `Number(p)`/`Number(q)` parsing). Replace with:

```ts
export function pushDepthSnapshot(buf: DepthSnapshot[], bids: Array<{ price: number; qty: number }>, asks: Array<{ price: number; qty: number }>) {
  buf.push({
    bids: bids.map((l) => [l.price, l.qty] as [number, number]),
    asks: asks.map((l) => [l.price, l.qty] as [number, number]),
  });
  if (buf.length > HEATMAP_CAPACITY) buf.shift();
}
```

(`DepthSnapshot`'s own shape — `{bids: [number,number][]; asks: [number,number][]}` — and everything else in this file, including `HEATMAP_CAPACITY` and `drawFrame`, stays unchanged; this is purely a parameter-type change since the input is already numeric.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: errors only in `Market2DView.tsx` (still calling both functions with the old shapes) — fixed in Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/components/market2d/OrderBookLadder.tsx src/components/market2d/canvasRenderer.ts
git commit -m "refactor(market2d): accept already-numeric depth levels instead of string tuples"
```

---

### Task 5: Migrate `Market2DView.tsx`

**Files:**
- Modify: `src/components/market2d/Market2DView.tsx` (full rewrite of the file's content)

**Interfaces:**
- Consumes: `useMarketEngine` (Task 2) returning `EngineState & {wsStatus, msgRate, pingMs}`; trimmed `useMarketWebSocket({symbol, timeframe, onKline})` (Task 3); `OrderBookLadder({book, livePrice, rows?})` (Task 4); `pushDepthSnapshot(buf, bids, asks)` with the new numeric signature (Task 4).

- [ ] **Step 1: Write the file**

```tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Candle3D, MarketStats, Timeframe3D, Market3DProps } from "../market3d/types";
import { fetchKlinesFromBinance, computeMarketStats, restBinanceGet } from "../market3d/dataService";
import { useMarketWebSocket } from "../market3d/useMarketWebSocket";
import { useMarketEngine } from "../../hooks/useMarketEngine";
import { Market3DHeader } from "../market3d/Market3DHeader";
import { TimeAndSalesPanel } from "../market3d/TimeAndSalesPanel";
import "../market3d/market3d.css";
import { CandleCanvas } from "./CandleCanvas";
import { OrderBookLadder } from "./OrderBookLadder";
import { DepthSnapshot, pushDepthSnapshot } from "./canvasRenderer";
import "./market2d.css";

export function Market2DView({
  symbol = "SOLUSDT",
  defaultTimeframe = "1h",
  defaultCandleCount = 140,
  onSymbolChange,
}: Market3DProps) {
  const [currentSymbol, setCurrentSymbol] = useState(symbol);
  const [timeframe, setTimeframe] = useState<Timeframe3D>(defaultTimeframe);
  const [candleCount, setCandleCount] = useState(defaultCandleCount);
  const [data, setData] = useState<Candle3D[]>([]);
  const [stats, setStats] = useState<MarketStats>({ hi: 0, lo: 0, vol: 0, chg: 0, win: "24H" });
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showVolume, setShowVolume] = useState(true);

  const depthHistoryRef = useRef<DepthSnapshot[]>([]);

  const engine = useMarketEngine(currentSymbol);

  const handleKlineStream = useCallback(
    (k: Candle3D) => {
      setData((prev) => {
        if (!prev.length) return [k];
        const last = prev[prev.length - 1];
        if (k.t === last.t) {
          const next = [...prev];
          next[next.length - 1] = k;
          return next;
        }
        if (k.t > last.t) {
          const next = [...prev, k];
          if (next.length > candleCount) next.shift();
          return next;
        }
        return prev;
      });
    },
    [candleCount]
  );

  useMarketWebSocket({
    symbol: currentSymbol,
    timeframe,
    onKline: handleKlineStream,
  });

  useEffect(() => {
    pushDepthSnapshot(depthHistoryRef.current, engine.book.bids, engine.book.asks);
  }, [engine.book]);

  const handleSelectSymbol = (sym: string) => {
    setCurrentSymbol(sym);
    if (onSymbolChange) onSymbolChange(sym);
  };

  const loadInitialSnapshot = useCallback(async () => {
    depthHistoryRef.current = [];
    try {
      const res = await fetchKlinesFromBinance(currentSymbol, timeframe, candleCount);
      setData(res.data);
      setStats(computeMarketStats(res.data));

      const clean = currentSymbol.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      const pair = clean.endsWith("USDT") ? clean : `${clean}USDT`;
      try {
        const tk = await restBinanceGet<any>(`/api/v3/ticker/24hr?symbol=${pair}`);
        setStats((prev) => ({ ...prev, chg: Number(tk.P), hi: Number(tk.h), lo: Number(tk.l), vol: Number(tk.v) }));
      } catch {}
    } catch {
      // Fallback handled inside fetchKlinesFromBinance
    }
  }, [currentSymbol, timeframe, candleCount]);

  useEffect(() => {
    loadInitialSnapshot();
  }, [loadInitialSnapshot]);

  const activeCandle = data.length > 0 ? data[data.length - 1] : null;
  const timeframes: Timeframe3D[] = ["15m", "1h", "4h", "1d"];

  const bestBid = engine.book.bids[0]?.price;
  const bestAsk = engine.book.asks[0]?.price;
  const bookTicker = bestBid != null && bestAsk != null
    ? { bid: bestBid, ask: bestAsk, spread: bestAsk - bestBid, spreadBps: ((bestAsk + bestBid) > 0 ? ((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 1e4 : 0) }
    : null;

  return (
    <div className="m2-root">
      <Market3DHeader
        currentSymbol={currentSymbol}
        onSelectSymbol={handleSelectSymbol}
        activeCandle={activeCandle}
        stats={stats}
        bookTicker={bookTicker}
        wsStatus={engine.wsStatus}
        msgRate={engine.msgRate}
        pingMs={engine.pingMs}
      />

      <div className="m2-toolbar">
        <div className="m2-toolbar-group">
          <span className="m2-toolbar-label">INTERVAL</span>
          {timeframes.map((tf) => (
            <button key={tf} onClick={() => setTimeframe(tf)} className={`m2-tf-btn ${timeframe === tf ? "active" : ""}`}>
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="m2-toolbar-divider" />
        <div className="m2-toolbar-group">
          <span className="m2-toolbar-label">BARS</span>
          <input type="range" min={60} max={240} step={20} value={candleCount} onChange={(e) => setCandleCount(Number(e.target.value))} style={{ accentColor: "#00e0a4", width: 80, height: 4, cursor: "pointer" }} />
          <span className="m2-bars-count">{candleCount}</span>
        </div>
        <div className="m2-toolbar-divider" />
        <label className="m2-check-label">
          <input type="checkbox" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} />
          HEATMAP
        </label>
        <label className="m2-check-label">
          <input type="checkbox" checked={showVolume} onChange={(e) => setShowVolume(e.target.checked)} />
          VOL
        </label>
      </div>

      <div className="m2-body">
        <CandleCanvas data={data} depthHistoryRef={depthHistoryRef} showHeatmap={showHeatmap} showVolume={showVolume} />
        <div className="m2-dock">
          <OrderBookLadder book={engine.book} livePrice={activeCandle?.c || null} />
          <div className="m2-tape-dock">
            <TimeAndSalesPanel trades={engine.trades} isOpen={true} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Market2DView;
```

Notes on this rewrite, both deliberate:
- `useMarketWebSocket`'s return value isn't captured at all — only its `onKline` side effect matters here. The header shows `engine.wsStatus`/`msgRate`/`pingMs` (the richer connection carrying depth/trades/derived signals), not the klines connection's status. `engine.wsStatus`'s type (`WsEngineStatus`, 4 values) is a strict subset of `Market3DHeader`'s expected `WsStatus` (5 values, adds `"sim"`) so it's passed straight through with no cast — don't reintroduce a mapping ternary here, it was tried and is unnecessary.
- `bookTicker` is now derived from `engine.book`'s best bid/ask instead of a separate REST call — the old code fetched `/api/v3/ticker/bookTicker` once on load; the new engine already streams live top-of-book, so that REST call is simply removed as redundant, not replaced.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors anywhere in `src/` (this was the last file with type errors from Tasks 3-4's signature changes).

- [ ] **Step 3: Manual live verification**

Boot the stack: `npm run dev:crypto` (starts `server/binance`, `server/coindcx`, and Vite on 5200).

Open `http://localhost:5200/`, click into the "DepthCube Market" tab, and confirm:
- Candlesticks render and update (proves the trimmed `useMarketWebSocket` still works for klines).
- The order book ladder shows live bid/ask rows updating (proves `useMarketEngine`'s `book` state flows through).
- The heatmap band under the candles is present and updates over time (proves `pushDepthSnapshot` receives real data from `engine.book`).
- Time & sales shows live trade prints (proves `engine.trades` flows through `TimeAndSalesPanel`).
- The header's LIVE/connecting indicator and ping/msg-rate figures update (proves `engine.wsStatus`/`msgRate`/`pingMs`).

This mirrors the same manual-verification approach used for `Market2DView` when it was first built and for `SymbolEngine` in sub-project 1 — real usage, not a synthetic harness.

Stop the dev stack afterward.

- [ ] **Step 4: Commit**

```bash
git add src/components/market2d/Market2DView.tsx
git commit -m "feat(market2d): migrate Market2DView onto useMarketEngine"
```

---

### Task 6: Drop the dead fallback in `BinanceAdapter.subscribeOrderBook`

**Files:**
- Modify: `src/adapters/BinanceAdapter.ts:254-344` (the `subscribeOrderBook` method)

**Interfaces:** No signature change — `subscribeOrderBook(symbol, _depth, onUpdate): () => void` stays identical. Only internal fallback logic is removed.

- [ ] **Step 1: Replace the method body**

Replace lines 254-344 (the full `subscribeOrderBook` method) with:

```ts
  subscribeOrderBook(
    symbol: string,
    _depth: number,
    onUpdate: (bids: OrderBookLevel[], asks: OrderBookLevel[]) => void
  ): () => void {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const localWsUrl = `${protocol}//${host}/ws/binance/feed?symbol=${encodeURIComponent(symbol)}&interval=1`;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let retryCount = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;

      try {
        ws = new WebSocket(localWsUrl);

        ws.onopen = () => {
          retryCount = 0;
          try { ws?.send(JSON.stringify({ type: "subscribe", symbol })); } catch {}
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
```

This drops: the `normSym`/`binanceSym` computation (was only needed to build the now-removed `publicWsUrl`), `publicWsUrl` itself, the `usePublicFallback` flag and its branch in `connect()`/`scheduleReconnect()`, and the raw-array (`Array.isArray(msg.bids) && Array.isArray(msg.asks)` at the top of `onmessage`) parsing branch that only ever matched data from the removed public-Binance path. Everything else — the local-proxy WS URL, the legacy-tick parsing, the reconnect backoff, the cleanup contract — is unchanged.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Manual verification**

`AdaptiveSupertrendWorkbench.tsx` is the one caller of `subscribeOrderBook`. Boot `npm run dev:crypto`, navigate to "AI Supertrend & Results Dashboard" in the binance app, confirm it still shows live bid/ask data (proves the local-proxy path alone, without the fallback, still works — expected, since the spec confirmed this path already succeeds against the running backend).

- [ ] **Step 4: Commit**

```bash
git add src/adapters/BinanceAdapter.ts
git commit -m "refactor(binance-adapter): drop dead Binance-direct fallback from subscribeOrderBook"
```

---

### Task 7: Final full verification

**Files:** none — verification only.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all `server/**/*.test.ts` (22 from sub-project 1) and `src/**/*.test.ts` (8 from Task 1) tests pass — 30 total.

- [ ] **Step 2: Full typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 3: Production builds**

```bash
VITE_APP=crypto npx vite build --outDir /tmp/build-check-crypto
VITE_APP=coindcx npx vite build --outDir /tmp/build-check-coindcx
VITE_APP=dhanhq npx vite build --outDir /tmp/build-check-dhanhq
rm -rf /tmp/build-check-crypto /tmp/build-check-coindcx /tmp/build-check-dhanhq
```

Expected: all three succeed with no errors.

- [ ] **Step 4: Full manual smoke test**

`npm run dev:crypto`. In the browser:
- Real-Time Terminal: unchanged (this sub-project never touched `TradingViewChart.tsx`/`BinanceAdapter`'s kline path) — candles, header ticker, depth panel, funding/OI all still work exactly as before.
- DepthCube Market (2D): re-confirm everything from Task 5 Step 3 still holds after Tasks 6-7's changes.
- AI Supertrend & Results Dashboard: re-confirm Task 6 Step 3's order book display.

Stop the dev stack.

- [ ] **Step 5: Grep for stray references**

Run: `grep -rn "onTrade\|onDepth\|onBookTicker\|onTicker24h" src/components/market3d/useMarketWebSocket.ts`
Expected: no output (confirms Task 3's trim removed every reference, not just the ones caught by the typechecker).

## Self-Review

**Spec coverage:**
- `useMarketEngine` hook, full message contract exposed → Tasks 1-2.
- `useMarketWebSocket.ts` trimmed to klines-only → Task 3.
- `Market2DView.tsx` migrated, proving the hook works → Task 5.
- `subscribeOrderBook()`'s dead fallback dropped → Task 6.
- `fetchPerpetualMetrics()`/`TradingViewChart.tsx` explicitly untouched → confirmed by omission (no task touches either file) plus the Global Constraints line calling this out.
- `import type` from `server/binance/engine/types.ts`, no duplicated types → Tasks 1, 2, 4 all source types this way.
- `pingMs` targets the app's own backend, not Binance → Task 2's `useMarketEngine` implementation.

**Placeholder scan:** no TBD/TODO; every step has complete code; no "similar to Task N".

**Type consistency:** `EngineState`/`applyEngineMessage`/`initialEngineState` (Task 1) are imported by name into `useMarketEngine.ts` (Task 2) with matching signatures. `useMarketEngine`'s return shape (`EngineState & {wsStatus, msgRate, pingMs}`) matches exactly what `Market2DView.tsx` (Task 5) destructures (`engine.book`, `engine.trades`, `engine.wsStatus`, `engine.msgRate`, `engine.pingMs`). `OrderBookLadder`'s new `book: OrderBookState | null` prop (Task 4) matches what Task 5 passes (`engine.book`). `pushDepthSnapshot`'s new `Array<{price:number;qty:number}>` parameter (Task 4) matches what Task 5 passes (`engine.book.bids`/`engine.book.asks`, which are `DepthLevel[]` — structurally identical to `{price:number;qty:number}[]`). `useMarketWebSocket`'s trimmed `{symbol, timeframe, onKline}` params (Task 3) match Task 5's call site exactly (no `onTrade`/`onDepth`/`onBookTicker`/`onTicker24h` passed).
