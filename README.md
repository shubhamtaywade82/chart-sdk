# Broker-Agnostic Trading Chart SDK (`chart-sdk`)

A high-performance, modular, and broker-agnostic trading chart and analytics SDK powered by **TradingView Lightweight Charts v5**, built with **React 19**, **TypeScript 5.9**, and **Vite 6**.

Designed with the **DataAdapter Pattern**, the chart engine, indicator suites (SMC, ICT, Volume Profile/VPVR, Candlestick Patterns), order book visualizations, and paper trading tools are completely decoupled from broker-specific endpoints.

---

## 📑 Table of Contents

- [Architecture Overview](#-architecture-overview)
- [Directory Structure](#-directory-structure)
- [The `IDataAdapter` Contract](#-the-idataadapter-contract)
- [Included Adapters](#-included-adapters)
- [Chart Engine & Indicator Suite](#-chart-engine--indicator-suite)
- [Quickstart & Running Apps](#-quickstart--running-apps)
- [Step-by-Step: Adding a New Broker](#-step-by-step-adding-a-new-broker)
- [Production Builds](#-production-builds)

---

## 🏛 Architecture Overview

Previously, broker implementations required separate codebases and duplicate chart maintenance. `chart-sdk` unifies all charting logic under a single source of truth:

```
                  ┌────────────────────────┐
                  │    TradingViewChart    │  (Broker-Blind Component)
                  │   + SMC / ICT / VPVR   │
                  └───────────┬────────────┘
                              │
                    implements│ IDataAdapter
                              │
          ┌───────────────────┴───────────────────┐
          │                                       │
┌──────────────────┐                    ┌──────────────────┐
│  BinanceAdapter  │                    │   DhanHQAdapter  │
└─────────┬────────┘                    └─────────┬────────┘
          │                                       │
    REST / WS (USD-M)                       REST / WS (NSE)
```

- **TradingViewChart** only communicates with `IDataAdapter`. It never imports broker-specific APIs.
- **Zero Dead Code**: Vite build aliases and `VITE_APP` environment definitions bundle only the targeted adapter and shell per build target.

---

## 📁 Directory Structure

```
chart-sdk/
├── src/
│   ├── adapters/
│   │   ├── IDataAdapter.ts        # The core contract all brokers implement
│   │   ├── BinanceAdapter.ts      # Binance Futures (24/7 Crypto, USD-M)
│   │   ├── DhanHQAdapter.ts       # DhanHQ NSE (Indian Equities & F&O)
│   │   └── index.ts               # Barrel export for adapters
│   ├── components/
│   │   ├── TradingViewChart.tsx   # Core adapter-driven chart component
│   │   ├── MarketDepthStream.tsx  # L2 order book stream & visualizer
│   │   ├── ExpiredOptionsTable.tsx# DhanHQ-specific options expiration matrix
│   │   ├── OptDeskExpiryArchivePage.tsx
│   │   ├── research/              # Binance research workbenches & backtesting
│   │   │   ├── FuturesBacktestWorkbench.tsx
│   │   │   └── PositioningAnalyticsView.tsx
│   │   └── research_dhanhq/       # DhanHQ research workbenches
│   │       └── OptionsResearchWorkbench.tsx
│   ├── utils/
│   │   ├── smcEngine.ts           # Smart Money Concepts, VPVR, POC/VAH/VAL, FVG, OB
│   │   ├── ictEngine.ts           # ICT Sessions, Silver Bullet, Judas Swing, AMD, OTE
│   │   ├── setupScanner.ts        # HTF bias ladder & signal detection
│   │   └── paperTrader.ts         # In-memory paper execution & ledger engine
│   ├── apps/
│   │   ├── binance/
│   │   │   └── App.tsx            # Binance app shell (instantiates BinanceAdapter)
│   │   └── dhanhq/
│   │       └── App.tsx            # DhanHQ app shell (instantiates DhanHQAdapter)
│   ├── main.tsx                   # Dynamic app bootstrapper
│   └── index.css                  # Unified dark mode cyber theme
├── package.json
├── tsconfig.json
├── vite.config.ts                 # Multi-backend proxy & dynamic bundle configuration
└── README.md
```

---

## 🔌 The `IDataAdapter` Contract

All broker connectors implement `IDataAdapter` (`src/adapters/IDataAdapter.ts`):

```typescript
export interface Candle {
  time: number;   // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBookLevel {
  price: number;
  qty: number;
}

export interface TickPayload {
  price: number;
  bid: number;
  ask: number;
  spread: number;
  bidQty?: number;
  askQty?: number;
}

export interface SymbolDef {
  key: string;        // e.g. "btcusdt" or "nifty"
  label: string;      // e.g. "BTC/USDT" or "NIFTY 50"
  precision: number;  // Price decimal places
}

export interface IntervalDef {
  key: string;        // e.g. "1", "5", "15"
  label: string;      // e.g. "1m", "5m", "15m"
}

export interface FundsSnapshot {
  equity: number;
  availableMargin: number;
  usedMargin: number;
  currency: string;
}

export interface IDataAdapter {
  // Identity
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly is24x7: boolean;

  // Catalogue
  getSymbols(): SymbolDef[];
  getIntervals(): IntervalDef[];

  // Data Fetching
  fetchCandles(symbol: string, interval: string, limit?: number): Promise<Candle[]>;
  fetchHistoricalCandles(symbol: string, interval: string, fromTs: number, toTs: number): Promise<Candle[]>;

  // Real-time Tick & Candle Subscriptions
  subscribeToTick(
    symbol: string,
    interval: string,
    onCandle: (candle: Candle) => void,
    onTick: (tick: TickPayload) => void
  ): () => void;

  // Optional: Depth & Account methods
  subscribeOrderBook?(
    symbol: string,
    depth: number,
    onUpdate: (bids: OrderBookLevel[], asks: OrderBookLevel[]) => void
  ): () => void;

  fetchFunds?(): Promise<FundsSnapshot>;
  fetchPositions?(): Promise<any[]>;
  fetchOrders?(): Promise<any[]>;
}
```

---

## 📦 Included Adapters

### 1. `BinanceAdapter` (`src/adapters/BinanceAdapter.ts`)
- **Market**: Crypto Futures USD-M (BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT)
- **Timeframes**: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 1D
- **Features**: 24/7 continuous stream, real-time WebSocket tick pipeline, L2 order book.

### 2. `DhanHQAdapter` (`src/adapters/DhanHQAdapter.ts`)
- **Market**: NSE/BSE Indian Indices & Equities (NIFTY 50, BANK NIFTY, SENSEX, RELIANCE, HDFCBANK, TCS, INFY)
- **Timeframes**: 1m, 5m, 15m, 30m, 1h
- **Features**: Market session hours awareness, option chain/desk feeds, ₹ currency handling.

---

## 🚀 Chart Engine & Indicator Suite

The shared `TradingViewChart` includes advanced trading visuals out-of-the-box:

1. **Volume Profile (VPVR)**: Real-time Point of Control (POC - Amber line), Value Area High (VAH - Cyan line), and Value Area Low (VAL - Purple line) with dual-color volume histogram.
2. **Smart Money Concepts (SMC)**:
   - Fair Value Gaps (FVG)
   - Order Blocks (OB)
   - Break of Structure (BOS) & Change of Character (CHoCH)
   - Buy-Side & Sell-Side Liquidity (BSL / SSL)
   - Equilibrium & Premium/Discount Ranges
3. **ICT Engine**: Silver Bullet time windows, Judas Swings, Accumulation-Manipulation-Distribution (AMD) cycles, and Optimal Trade Entry (OTE) zones.
4. **Candle Alignment & Gapless Engine**:
   - `fillCandleGaps`: Snaps timestamps to exact interval boundaries and auto-fills missing exchange slots with flat synthetic candles.
   - Time-based lazy-loading on scroll past historical boundaries (`getVisibleRange()`).
5. **Ultra-Smooth 60 FPS LERP Loop**: Gliding live price and volume transitions between WebSocket updates.
6. **Dynamic Bid-Ask Spread Visualizer**: Zoom-responsive spread line with precision-matched live price delta.
7. **Color Themes & Hollow Candles**: 6 curated presets (Cyber Emerald, Classic TV, Electric Ice, Solar Gold, Midnight Neon, Black & White) with inline hollow candle mode.

---

## ⚡ Quickstart & Running Apps

Install dependencies:
```bash
cd chart-sdk
npm install
```

### Launch Binance Futures Chart
```bash
npm run dev:binance
# Opens on http://localhost:5200 (proxies API to localhost:3002)
```

### Launch DhanHQ NSE Chart
```bash
npm run dev:dhanhq
# Opens on http://localhost:5201 (proxies API to localhost:3003)
```

---

## 🛠 Step-by-Step: Adding a New Broker

To connect a new broker (e.g., **CoinDCX**, **Bybit**, **Interactive Brokers**, or **Zerodha**):

### 1. Implement `IDataAdapter`
Create `src/adapters/CoinDCXAdapter.ts`:
```typescript
import type { IDataAdapter, Candle, TickPayload, SymbolDef, IntervalDef } from "./IDataAdapter";

export class CoinDCXAdapter implements IDataAdapter {
  readonly id = "coindcx";
  readonly name = "CoinDCX Futures";
  readonly currency = "₹";
  readonly is24x7 = true;

  getSymbols(): SymbolDef[] {
    return [
      { key: "B-BTC_USDT", label: "BTC/USDT", precision: 2 },
      { key: "B-ETH_USDT", label: "ETH/USDT", precision: 2 },
    ];
  }

  getIntervals(): IntervalDef[] {
    return [
      { key: "1", label: "1m" },
      { key: "5", label: "5m" },
      { key: "15", label: "15m" },
    ];
  }

  async fetchCandles(symbol: string, interval: string): Promise<Candle[]> {
    const res = await fetch(`/api/coindcx/candles?pair=${symbol}&interval=${interval}`);
    const json = await res.json();
    return json.candles;
  }

  async fetchHistoricalCandles(symbol: string, interval: string, fromTs: number, toTs: number): Promise<Candle[]> {
    const res = await fetch(`/api/coindcx/candles/history?pair=${symbol}&from=${fromTs}&to=${toTs}`);
    const json = await res.json();
    return json.candles;
  }

  subscribeToTick(symbol: string, interval: string, onCandle: (c: Candle) => void, onTick: (t: TickPayload) => void) {
    const ws = new WebSocket(`/ws/coindcx?pair=${symbol}`);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.candle) onCandle(msg.candle);
      if (msg.tick) onTick(msg.tick);
    };
    return () => ws.close();
  }
}
```

### 2. Export the Adapter
In `src/adapters/index.ts`:
```typescript
export { CoinDCXAdapter } from "./CoinDCXAdapter";
```

### 3. Create the App Shell
Create `src/apps/coindcx/App.tsx`:
```tsx
import React, { useState } from "react";
import { TradingViewChart } from "../../components/TradingViewChart";
import { CoinDCXAdapter } from "../../adapters/CoinDCXAdapter";

const adapter = new CoinDCXAdapter();

export function App() {
  const [symbol, setSymbol] = useState("B-BTC_USDT");
  const [interval, setInterval] = useState("15");

  return (
    <div className="chart-app-container">
      <TradingViewChart
        adapter={adapter}
        symbol={symbol}
        interval={interval}
        showIndicators={true}
      />
    </div>
  );
}

export default App;
```

### 4. Add npm Run Script
In `package.json`:
```json
{
  "scripts": {
    "dev:coindcx": "VITE_APP=coindcx vite --port 5202"
  }
}
```

Run `npm run dev:coindcx` — your chart with all SMC overlays, Volume Profile, and indicators will render immediately with zero duplicate code!

---

## 🏗 Production Builds

Build a production bundle for a specific broker application:

```bash
# Build Binance distribution (output to dist/binance)
npm run build:binance

# Build DhanHQ distribution (output to dist/dhanhq)
npm run build:dhanhq
```

Verify type safety anytime:
```bash
npm run typecheck
```
