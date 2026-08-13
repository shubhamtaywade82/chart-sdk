# SMC/ICT Confluence Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backtestable "SMC/ICT Confluence" strategy — walking `scanSetups()` (which already fuses every SMC/ICT indicator into one signal) bar-by-bar over historical candles — and expose it as a new tab in all three broker apps.

**Architecture:** `scanSetups()` gets a small backward-compatible `asOf` parameter so it can be replayed against historical timestamps instead of `Date.now()`. A new engine module walks candles, opens/closes simulated trades against the signal's recommended stop/target, and returns win-rate/PF/drawdown/equity-curve/trade-log data. A new UI component (same shell as `FuturesBacktestWorkbench.tsx`) renders it, wired into a new tab per app.

**Tech Stack:** TypeScript, React 19, existing `smcEngine.ts`/`ictEngine.ts`/`setupScanner.ts`. No test framework exists in this repo (no jest/vitest, no existing `*.test.ts` files, no `test` npm script) — verification is `npm run typecheck` plus manual dev-server checks, matching how every other engine/component in this repo (`adaptiveSupertrend.ts`, `smcEngine.ts`, `FuturesBacktestWorkbench.tsx`) was verified.

## Global Constraints

- Repo convention: no unit test framework. Verify with `npm run typecheck` (must pass with zero errors) and manual dev-server smoke checks.
- Follow existing code style exactly: inline `style={{...}}` objects, `var(--accent-green)`/`var(--accent-red)`/`var(--text-muted)` CSS custom properties, `glass-panel`/`glass-card` classes — do not introduce a new styling approach.
- `scanSetups()`'s existing call site in `TradingViewChart.tsx` must continue to work unmodified — the new parameter must be optional and default to current behavior.
- Functions ≤30 lines, files ≤300 lines (per project CLAUDE.md) — decompose the backtest loop into named helpers rather than one long function.

---

### Task 1: Inject a replayable clock into `scanSetups`

**Files:**
- Modify: `src/utils/setupScanner.ts:325` (function signature) and `:326` (the `now` assignment)

**Interfaces:**
- Produces: `scanSetups(input: SetupScanInput, asOf?: number): SetupSignal` — `asOf` is a Unix-seconds timestamp; when omitted, behavior is identical to today (`Date.now()`-based).

- [ ] **Step 1: Make the edit**

In `src/utils/setupScanner.ts`, change:

```ts
export function scanSetups(input: SetupScanInput): SetupSignal {
  const now = Math.floor(Date.now() / 1000);
```

to:

```ts
export function scanSetups(input: SetupScanInput, asOf?: number): SetupSignal {
  const now = asOf ?? Math.floor(Date.now() / 1000);
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors (existing `scanSetups(input)` call in `TradingViewChart.tsx` still type-checks since `asOf` is optional).

- [ ] **Step 3: Commit**

```bash
git add src/utils/setupScanner.ts
git commit -m "Allow scanSetups to replay a historical timestamp for backtesting"
```

---

### Task 2: Build the confluence backtest engine

**Files:**
- Create: `src/utils/confluenceBacktestEngine.ts`

**Interfaces:**
- Consumes: `scanSetups(input, asOf)` and `SetupScanInput` from `./setupScanner` (Task 1); `detectFVGs`, `detectOrderBlocks`, `detectMarketStructure`, `detectLiquidityPools`, `detectPremiumDiscount`, `detectSupplyDemandZones`, `detectTrendlineLiquidity`, `detectCandlestickPatterns` from `./smcEngine`; `detectICTSessions`, `detectSilverBulletWindows`, `detectICTOTEZone`, `detectJudasSwings`, `detectAMDCycles` from `./ictEngine`; `Candle` from `../adapters/IDataAdapter`.
- Produces: `runConfluenceBacktest(candles: Candle[], symbol: string, options?: ConfluenceBacktestOptions): ConfluenceBacktestSummary`, plus the exported types `ConfluenceBacktestTrade`, `ConfluenceBacktestSummary`, `ConfluenceBacktestOptions` — consumed by Task 3.

- [ ] **Step 1: Write the file**

```ts
import type { Candle } from "../adapters/IDataAdapter";
import {
  detectFVGs,
  detectOrderBlocks,
  detectMarketStructure,
  detectLiquidityPools,
  detectPremiumDiscount,
  detectSupplyDemandZones,
  detectTrendlineLiquidity,
  detectCandlestickPatterns,
} from "./smcEngine";
import {
  detectICTSessions,
  detectSilverBulletWindows,
  detectICTOTEZone,
  detectJudasSwings,
  detectAMDCycles,
} from "./ictEngine";
import { scanSetups, type SetupScanInput } from "./setupScanner";

export interface ConfluenceBacktestTrade {
  id: number;
  entryTime: number;
  exitTime: number;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  targetPrice: number;
  pnlPct: number;
  exitReason: "STOP_LOSS" | "TAKE_PROFIT";
  alignedCount: number;
  notes: string[];
}

export interface ConfluenceBacktestSummary {
  initialEquity: number;
  finalEquity: number;
  netProfitPct: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  equityCurve: { time: number; equity: number }[];
  trades: ConfluenceBacktestTrade[];
}

export interface ConfluenceBacktestOptions {
  /** Bars to skip before the first scan, so detectors have history to work with. */
  warmupBars?: number;
  /** Rolling lookback window fed to the detectors at each bar. */
  windowBars?: number;
  initialEquity?: number;
  /** Fraction of equity risked per trade, sized off the signal's stop distance. */
  riskPctPerTrade?: number;
}

interface OpenPosition {
  side: "LONG" | "SHORT";
  entryTime: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  alignedCount: number;
  notes: string[];
}

function buildSetupInput(window: Candle[], symbol: string): SetupScanInput {
  return {
    lastPrice: window[window.length - 1].close,
    fvg: detectFVGs(window),
    ob: detectOrderBlocks(window),
    structure: detectMarketStructure(window),
    liquidity: detectLiquidityPools(window),
    pd: detectPremiumDiscount(window),
    sessions: detectICTSessions(window),
    sb: detectSilverBulletWindows(window),
    ote: detectICTOTEZone(window),
    judas: detectJudasSwings(window),
    amd: detectAMDCycles(window),
    sd: detectSupplyDemandZones(window),
    tl: detectTrendlineLiquidity(window),
    cp: detectCandlestickPatterns(window),
    symbol,
  };
}

function tryOpenPosition(bar: Candle, window: Candle[], symbol: string): OpenPosition | null {
  const signal = scanSetups(buildSetupInput(window, symbol), bar.time);
  if (signal.direction === "NO_TRADE" || !signal.recommendedEntry) return null;

  const { side, entry, stop, target } = signal.recommendedEntry;
  return {
    side,
    entryTime: bar.time,
    entryPrice: entry.price,
    stopPrice: stop.price,
    targetPrice: target.price,
    alignedCount: signal.alignedCount,
    notes: signal.notes,
  };
}

function checkExit(
  bar: Candle,
  position: OpenPosition
): { exitPrice: number; exitReason: "STOP_LOSS" | "TAKE_PROFIT" } | null {
  const hitStop = position.side === "LONG" ? bar.low <= position.stopPrice : bar.high >= position.stopPrice;
  const hitTarget = position.side === "LONG" ? bar.high >= position.targetPrice : bar.low <= position.targetPrice;

  // Stop-first convention when both trigger within the same bar (conservative).
  if (hitStop) return { exitPrice: position.stopPrice, exitReason: "STOP_LOSS" };
  if (hitTarget) return { exitPrice: position.targetPrice, exitReason: "TAKE_PROFIT" };
  return null;
}

function pnlPctFor(position: OpenPosition, exitPrice: number): number {
  const raw =
    position.side === "LONG"
      ? (exitPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - exitPrice) / position.entryPrice;
  return Number((raw * 100).toFixed(3));
}

function closePosition(
  bar: Candle,
  position: OpenPosition,
  equity: number,
  riskPctPerTrade: number
): { trade: ConfluenceBacktestTrade; newEquity: number } | null {
  const exit = checkExit(bar, position);
  if (!exit) return null;

  const pnlPct = pnlPctFor(position, exit.exitPrice);
  const stopDistPct = Math.abs(position.entryPrice - position.stopPrice) / position.entryPrice;
  const notional = stopDistPct > 0 ? (equity * riskPctPerTrade) / stopDistPct : 0;
  const newEquity = equity + (pnlPct / 100) * notional;

  return {
    newEquity,
    trade: {
      id: 0,
      entryTime: position.entryTime,
      exitTime: bar.time,
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice: exit.exitPrice,
      stopPrice: position.stopPrice,
      targetPrice: position.targetPrice,
      pnlPct,
      exitReason: exit.exitReason,
      alignedCount: position.alignedCount,
      notes: position.notes,
    },
  };
}

function summarize(
  trades: ConfluenceBacktestTrade[],
  initialEquity: number,
  finalEquity: number,
  maxDrawdownPct: number
): Omit<ConfluenceBacktestSummary, "equityCurve" | "trades"> {
  const winCount = trades.filter((t) => t.pnlPct > 0).length;
  const lossCount = trades.filter((t) => t.pnlPct <= 0).length;
  const grossWin = trades.filter((t) => t.pnlPct > 0).reduce((a, t) => a + t.pnlPct, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnlPct < 0).reduce((a, t) => a + t.pnlPct, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 5 : 1;

  return {
    initialEquity,
    finalEquity: Number(finalEquity.toFixed(2)),
    netProfitPct: Number((((finalEquity - initialEquity) / initialEquity) * 100).toFixed(2)),
    totalTrades: trades.length,
    winCount,
    lossCount,
    winRatePct: trades.length > 0 ? Number(((winCount / trades.length) * 100).toFixed(1)) : 0,
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
  };
}

/**
 * Walks candles bar-by-bar through scanSetups() (the confluence engine that already
 * fuses every SMC/ICT signal) and simulates trades against its recommended stop/target.
 */
export function runConfluenceBacktest(
  candles: Candle[],
  symbol: string,
  options: ConfluenceBacktestOptions = {}
): ConfluenceBacktestSummary {
  const warmupBars = options.warmupBars ?? 200;
  const windowBars = options.windowBars ?? 300;
  const initialEquity = options.initialEquity ?? 10000;
  const riskPctPerTrade = options.riskPctPerTrade ?? 0.02;

  const trades: ConfluenceBacktestTrade[] = [];
  const equityCurve: { time: number; equity: number }[] = [
    { time: candles[0]?.time ?? 0, equity: initialEquity },
  ];
  let equity = initialEquity;
  let peakEquity = initialEquity;
  let maxDrawdownPct = 0;
  let position: OpenPosition | null = null;

  for (let i = warmupBars; i < candles.length; i++) {
    const bar = candles[i];

    if (position) {
      const closed = closePosition(bar, position, equity, riskPctPerTrade);
      if (!closed) continue;

      equity = closed.newEquity;
      peakEquity = Math.max(peakEquity, equity);
      maxDrawdownPct = Math.max(maxDrawdownPct, ((peakEquity - equity) / peakEquity) * 100);
      trades.push({ ...closed.trade, id: trades.length + 1 });
      equityCurve.push({ time: bar.time, equity: Number(equity.toFixed(2)) });
      position = null;
      continue;
    }

    const window = candles.slice(Math.max(0, i - windowBars), i + 1);
    position = tryOpenPosition(bar, window, symbol);
  }

  return { ...summarize(trades, initialEquity, equity, maxDrawdownPct), equityCurve, trades };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. This catches signature mismatches against `smcEngine.ts`/`ictEngine.ts`/`setupScanner.ts` immediately.

- [ ] **Step 3: Manual smoke check**

Add a throwaway script check (do not commit it) or, faster, verify via `node`'s ESM loader is not set up for this project — instead, confirm correctness by reading through the loop once against these invariants:
- `position` is null exactly when no trade is open (never opened while one is open — the `if (position) { ...; continue; }` branch guarantees this).
- `trades.length` equals `equityCurve.length - 1` (one curve point added per closed trade, plus the seed point).
- `maxDrawdownPct` is monotonically non-decreasing across the loop.

- [ ] **Step 4: Commit**

```bash
git add src/utils/confluenceBacktestEngine.ts
git commit -m "Add SMC/ICT confluence backtest engine"
```

---

### Task 3: Build the backtest page UI

**Files:**
- Create: `src/components/research/ConfluenceBacktestWorkbench.tsx`

**Interfaces:**
- Consumes: `runConfluenceBacktest`, `ConfluenceBacktestSummary` from `../../utils/confluenceBacktestEngine` (Task 2); `IDataAdapter` from `../../adapters/IDataAdapter`.
- Produces: `ConfluenceBacktestWorkbench: React.FC<{ symbol: string; adapter?: IDataAdapter }>` — consumed by Tasks 4–6.

- [ ] **Step 1: Write the file**

```tsx
import React, { useEffect, useState } from "react";
import { Play, TrendingUp, Activity, RefreshCw, Download } from "lucide-react";
import type { IDataAdapter } from "../../adapters/IDataAdapter";
import { runConfluenceBacktest, type ConfluenceBacktestSummary } from "../../utils/confluenceBacktestEngine";

interface ConfluenceBacktestProps {
  symbol: string;
  adapter?: IDataAdapter;
}

const HISTORY_BARS = 1500;

export const ConfluenceBacktestWorkbench: React.FC<ConfluenceBacktestProps> = ({ symbol, adapter }) => {
  const [selectedSymbol, setSelectedSymbol] = useState(symbol || "btcusdt");
  const [interval, setInterval] = useState("15m");
  const [riskPct, setRiskPct] = useState(2);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ConfluenceBacktestSummary | null>(null);

  useEffect(() => {
    if (symbol) setSelectedSymbol(symbol);
  }, [symbol]);

  const runBacktest = async () => {
    if (!adapter) return;
    setLoading(true);
    try {
      const candles = await adapter.fetchCandles(selectedSymbol, interval, HISTORY_BARS);
      setResult(
        candles.length >= 250
          ? runConfluenceBacktest(candles, selectedSymbol, { initialEquity: 10000, riskPctPerTrade: riskPct / 100 })
          : null
      );
    } catch (e) {
      console.error("Confluence backtest error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runBacktest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSymbol, interval, riskPct]);

  const exportCSV = () => {
    if (!result || result.trades.length === 0) return;
    const headers = "Trade ID,Side,Entry Price,Exit Price,PnL %,Aligned,Exit Reason";
    const rows = result.trades.map(
      (t) => `${t.id},${t.side},${t.entryPrice},${t.exitPrice},${t.pnlPct},${t.alignedCount}/6,"${t.exitReason}"`
    );
    const blob = new Blob([[headers, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Confluence_Backtest_${selectedSymbol}_${interval}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "20px" }} className="glass-panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
            <Activity size={20} color="var(--accent-green)" />
            SMC/ICT Confluence Backtest
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
            Walks every SMC & ICT signal (Order Blocks, FVG, BOS/CHoCH, Liquidity Sweeps, Judas Swing, Silver Bullet, OTE, Premium/Discount) through the confluence engine bar-by-bar.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)", color: "#fff", padding: "6px 10px", borderRadius: "6px", fontSize: "12px" }}
          >
            <option value="1m">1m Timeframe</option>
            <option value="5m">5m Timeframe</option>
            <option value="15m">15m Timeframe</option>
            <option value="1h">1h Timeframe</option>
            <option value="4h">4h Timeframe</option>
            <option value="1D">1D Timeframe</option>
          </select>

          <select
            value={riskPct}
            onChange={(e) => setRiskPct(Number(e.target.value))}
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)", color: "#fff", padding: "6px 10px", borderRadius: "6px", fontSize: "12px" }}
          >
            <option value={1}>1% Risk/Trade</option>
            <option value={2}>2% Risk/Trade</option>
            <option value={3}>3% Risk/Trade</option>
          </select>

          <button
            onClick={runBacktest}
            disabled={loading}
            style={{ background: "var(--accent-green)", color: "#0A0D14", border: "none", padding: "8px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            <span>RUN BACKTEST</span>
          </button>

          {result && result.trades.length > 0 && (
            <button
              onClick={exportCSV}
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "#fff", padding: "8px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
            >
              <Download size={14} />
              <span>EXPORT CSV</span>
            </button>
          )}
        </div>
      </div>

      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
          <div className="glass-card" style={{ padding: "14px", borderRadius: "8px" }}>
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>NET PNL</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: result.netProfitPct >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
              {result.netProfitPct >= 0 ? "+" : ""}{result.netProfitPct}%
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>
              Final: ${result.finalEquity.toLocaleString()}
            </div>
          </div>

          <div className="glass-card" style={{ padding: "14px", borderRadius: "8px" }}>
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>WIN RATE</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--accent-cyan)" }}>{result.winRatePct}%</div>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>
              {result.winCount} W / {result.lossCount} L ({result.totalTrades} total)
            </div>
          </div>

          <div className="glass-card" style={{ padding: "14px", borderRadius: "8px" }}>
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>PROFIT FACTOR</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "#FFD700" }}>{result.profitFactor}</div>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>Gross Win / Gross Loss</div>
          </div>

          <div className="glass-card" style={{ padding: "14px", borderRadius: "8px" }}>
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>MAX DRAWDOWN</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--accent-red)" }}>-{result.maxDrawdownPct}%</div>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>Peak-to-Trough</div>
          </div>
        </div>
      )}

      {result && result.equityCurve.length > 1 && (
        <div className="glass-card" style={{ padding: "14px", borderRadius: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
              <TrendingUp size={14} color="#00F5A0" />
              <span>Cumulative Equity Growth Curve</span>
            </div>
            <span style={{ fontSize: "11px", color: "#00F5A0", fontWeight: 700 }}>
              Peak: ${Math.max(...result.equityCurve.map((c) => c.equity)).toLocaleString()}
            </span>
          </div>

          <div style={{ height: "120px", width: "100%", display: "flex", alignItems: "flex-end", gap: "2px", background: "rgba(0,0,0,0.25)", padding: "8px", borderRadius: "6px", overflowX: "auto" }}>
            {(() => {
              const minEq = Math.min(...result.equityCurve.map((c) => c.equity));
              const maxEq = Math.max(...result.equityCurve.map((c) => c.equity));
              const range = Math.max(1, maxEq - minEq);
              return result.equityCurve.map((pt, i) => {
                const heightPct = Math.max(8, ((pt.equity - minEq) / range) * 100);
                const isGain = pt.equity >= result.initialEquity;
                return (
                  <div
                    key={i}
                    title={`Bar ${i + 1}: $${pt.equity.toLocaleString()}`}
                    style={{
                      flex: 1,
                      minWidth: "4px",
                      height: `${heightPct}%`,
                      background: isGain ? "linear-gradient(180deg, #00F5A0 0%, rgba(0, 245, 160, 0.2) 100%)" : "linear-gradient(180deg, #FF495C 0%, rgba(255, 73, 92, 0.2) 100%)",
                      borderRadius: "2px 2px 0 0",
                      transition: "height 0.3s ease",
                    }}
                  />
                );
              });
            })()}
          </div>
        </div>
      )}

      {result && result.trades.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-secondary)" }}>
            Confluence Trade History ({result.trades.length} trades)
          </div>
          <div style={{ overflowX: "auto", maxHeight: "350px", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-muted)", borderBottom: "1px solid var(--border-color)" }}>
                  <th style={{ padding: "10px" }}>ID</th>
                  <th style={{ padding: "10px" }}>SIDE</th>
                  <th style={{ padding: "10px" }}>ENTRY</th>
                  <th style={{ padding: "10px" }}>EXIT</th>
                  <th style={{ padding: "10px" }}>PNL %</th>
                  <th style={{ padding: "10px" }}>ALIGNED</th>
                  <th style={{ padding: "10px" }}>REASON</th>
                </tr>
              </thead>
              <tbody>
                {result.trades.map((t) => (
                  <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <td style={{ padding: "10px", fontFamily: "var(--font-mono)" }}>{t.id}</td>
                    <td style={{ padding: "10px", fontWeight: 700, color: t.side === "LONG" ? "var(--accent-green)" : "var(--accent-red)" }}>{t.side}</td>
                    <td style={{ padding: "10px", fontFamily: "var(--font-mono)" }}>${t.entryPrice.toLocaleString()}</td>
                    <td style={{ padding: "10px", fontFamily: "var(--font-mono)" }}>${t.exitPrice.toLocaleString()}</td>
                    <td style={{ padding: "10px", fontWeight: 700, color: t.pnlPct >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                      {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct}%
                    </td>
                    <td style={{ padding: "10px", color: "var(--text-secondary)" }}>{t.alignedCount}/6</td>
                    <td style={{ padding: "10px", fontSize: "11px", color: "var(--text-muted)" }}>{t.exitReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/research/ConfluenceBacktestWorkbench.tsx
git commit -m "Add SMC/ICT confluence backtest workbench UI"
```

---

### Task 4: Wire the tab into the Binance app

**Files:**
- Modify: `src/apps/binance/App.tsx:23` (import), `:48` (activeTab union), `:620-626` (sidebar array), `:741-744` (render block)

**Interfaces:**
- Consumes: `ConfluenceBacktestWorkbench` from Task 3.

- [ ] **Step 1: Add the import**

In `src/apps/binance/App.tsx`, find:

```tsx
import { FuturesBacktestWorkbench } from "../../components/research/FuturesBacktestWorkbench";
```

Add directly after it:

```tsx
import { FuturesBacktestWorkbench } from "../../components/research/FuturesBacktestWorkbench";
import { ConfluenceBacktestWorkbench } from "../../components/research/ConfluenceBacktestWorkbench";
```

- [ ] **Step 2: Extend the activeTab union**

Find:

```tsx
  const [activeTab, setActiveTab] = useState<"terminal" | "ai_supertrend" | "backtest" | "intel" | "bias" | "portfolio">(() => {
```

Replace with:

```tsx
  const [activeTab, setActiveTab] = useState<"terminal" | "ai_supertrend" | "backtest" | "confluence_backtest" | "intel" | "bias" | "portfolio">(() => {
```

- [ ] **Step 3: Add the sidebar entry**

Find:

```tsx
            { id: "backtest", label: "Futures Backtest Workbench", icon: Activity },
            { id: "intel", label: "Futures Intel & OI", icon: Layers },
```

Replace with:

```tsx
            { id: "backtest", label: "Futures Backtest Workbench", icon: Activity },
            { id: "confluence_backtest", label: "SMC/ICT Confluence Backtest", icon: Zap },
            { id: "intel", label: "Futures Intel & OI", icon: Layers },
```

- [ ] **Step 4: Add the render block**

Find:

```tsx
          {/* TAB 3: FUTURES BACKTEST WORKBENCH */}
          {activeTab === "backtest" && (
            <FuturesBacktestWorkbench symbol={selectedSymbol} adapter={adapterInstance} />
          )}

          {/* TAB 3: FUTURES MARKET INTEL & OPEN INTEREST */}
          {activeTab === "intel" && (
```

Replace with:

```tsx
          {/* TAB 3: FUTURES BACKTEST WORKBENCH */}
          {activeTab === "backtest" && (
            <FuturesBacktestWorkbench symbol={selectedSymbol} adapter={adapterInstance} />
          )}

          {/* TAB 3B: SMC/ICT CONFLUENCE BACKTEST */}
          {activeTab === "confluence_backtest" && (
            <ConfluenceBacktestWorkbench symbol={selectedSymbol} adapter={adapterInstance} />
          )}

          {/* TAB 3: FUTURES MARKET INTEL & OPEN INTEREST */}
          {activeTab === "intel" && (
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Manual smoke check**

Run: `npm run dev:binance`
Open `http://localhost:5200`, click "SMC/ICT Confluence Backtest" in the left nav, confirm it loads, shows metrics (or "no trades" gracefully if the symbol/interval combo produces none), and CSV export works when trades exist.

- [ ] **Step 7: Commit**

```bash
git add src/apps/binance/App.tsx
git commit -m "Wire SMC/ICT confluence backtest tab into Binance app"
```

---

### Task 5: Wire the tab into the DhanHQ app

**Files:**
- Modify: `src/apps/dhanhq/App.tsx:35` (import), `:70` (activeTab union), `:790-798` (sidebar array), `:1011-1017` (render block)

**Interfaces:**
- Consumes: `ConfluenceBacktestWorkbench` from Task 3.

- [ ] **Step 1: Add the import**

Find:

```tsx
import { AdaptiveSupertrendWorkbench } from "../../components/research/AdaptiveSupertrendWorkbench";
```

Add directly after it:

```tsx
import { AdaptiveSupertrendWorkbench } from "../../components/research/AdaptiveSupertrendWorkbench";
import { ConfluenceBacktestWorkbench } from "../../components/research/ConfluenceBacktestWorkbench";
```

- [ ] **Step 2: Extend the activeTab union**

Find:

```tsx
  const [activeTab, setActiveTab] = useState<"terminal" | "ai_supertrend" | "options" | "expired" | "optdesk" | "bias" | "portfolio">(() => {
```

Replace with:

```tsx
  const [activeTab, setActiveTab] = useState<"terminal" | "ai_supertrend" | "options" | "expired" | "optdesk" | "confluence_backtest" | "bias" | "portfolio">(() => {
```

- [ ] **Step 3: Add the sidebar entry**

Find:

```tsx
              { id: "optdesk", label: "OPTDESK Expiry Archive", icon: Database },
              { id: "bias", label: "Multi-Timeframe Bias", icon: TrendingUp },
```

Replace with:

```tsx
              { id: "optdesk", label: "OPTDESK Expiry Archive", icon: Database },
              { id: "confluence_backtest", label: "SMC/ICT Confluence Backtest", icon: Activity },
              { id: "bias", label: "Multi-Timeframe Bias", icon: TrendingUp },
```

- [ ] **Step 4: Add the render block**

Find:

```tsx
          {/* TAB 3B: OPTDESK EXPIRY ARCHIVE DEDICATED PAGE */}
          {activeTab === "optdesk" && (
            <OptDeskExpiryArchivePage />
          )}

          {/* TAB 4: TECHNICAL ANALYSIS MULTI-TIMEFRAME BIAS ENGINE */}
          {activeTab === "bias" && (
```

Replace with:

```tsx
          {/* TAB 3B: OPTDESK EXPIRY ARCHIVE DEDICATED PAGE */}
          {activeTab === "optdesk" && (
            <OptDeskExpiryArchivePage />
          )}

          {/* TAB 3C: SMC/ICT CONFLUENCE BACKTEST */}
          {activeTab === "confluence_backtest" && (
            <ConfluenceBacktestWorkbench symbol={selectedSymbol} adapter={adapterInstance} />
          )}

          {/* TAB 4: TECHNICAL ANALYSIS MULTI-TIMEFRAME BIAS ENGINE */}
          {activeTab === "bias" && (
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Manual smoke check**

Run: `npm run dev:dhanhq`
Open `http://localhost:5201`, click "SMC/ICT Confluence Backtest" in the left nav, confirm it loads and renders.

- [ ] **Step 7: Commit**

```bash
git add src/apps/dhanhq/App.tsx
git commit -m "Wire SMC/ICT confluence backtest tab into DhanHQ app"
```

---

### Task 6: Wire the tab into the CoinDCX app

**Files:**
- Modify: `src/apps/coindcx/App.tsx:5-18` (lucide import), after `:20` (component import), `:43` (activeTab union), sidebar array (~line 429), render block (~line 511-515)

**Interfaces:**
- Consumes: `ConfluenceBacktestWorkbench` from Task 3.

- [ ] **Step 1: Add `Activity` to the lucide import and add the component import**

Find:

```tsx
import {
  BarChart2,
  Clock,
  DollarSign,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Target,
  Wallet,
  Zap,
} from "lucide-react";
import { TradingViewChart, formatPriceDynamic, getPricePrecision } from "../../components/TradingViewChart";
import { MarketDepthStream } from "../../components/MarketDepthStream";
```

Replace with:

```tsx
import {
  Activity,
  BarChart2,
  Clock,
  DollarSign,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Target,
  Wallet,
  Zap,
} from "lucide-react";
import { TradingViewChart, formatPriceDynamic, getPricePrecision } from "../../components/TradingViewChart";
import { MarketDepthStream } from "../../components/MarketDepthStream";
import { ConfluenceBacktestWorkbench } from "../../components/research/ConfluenceBacktestWorkbench";
```

- [ ] **Step 2: Extend the activeTab union**

Find:

```tsx
  const [activeTab, setActiveTab] = useState<"terminal" | "portfolio">(() => {
```

Replace with:

```tsx
  const [activeTab, setActiveTab] = useState<"terminal" | "confluence_backtest" | "portfolio">(() => {
```

- [ ] **Step 3: Add the sidebar entry**

Find:

```tsx
              { id: "terminal", label: "Real-Time Terminal", icon: BarChart2 },
              { id: "portfolio", label: `Positions & Account (${positions.length})`, icon: Target },
```

Replace with:

```tsx
              { id: "terminal", label: "Real-Time Terminal", icon: BarChart2 },
              { id: "confluence_backtest", label: "SMC/ICT Confluence Backtest", icon: Activity },
              { id: "portfolio", label: `Positions & Account (${positions.length})`, icon: Target },
```

- [ ] **Step 4: Add the render block**

Find:

```tsx
              {showDepthPanel && (
                <MarketDepthStream bids={tick?.bids || []} asks={tick?.asks || []} symbol={selectedSymbol} />
              )}
            </div>
          )}

          {/* TAB 2: PORTFOLIO — real positions, orders & wallet */}
          {activeTab === "portfolio" && (
```

Replace with:

```tsx
              {showDepthPanel && (
                <MarketDepthStream bids={tick?.bids || []} asks={tick?.asks || []} symbol={selectedSymbol} />
              )}
            </div>
          )}

          {/* TAB 1B: SMC/ICT CONFLUENCE BACKTEST */}
          {activeTab === "confluence_backtest" && (
            <ConfluenceBacktestWorkbench symbol={selectedSymbol} adapter={adapterInstance} />
          )}

          {/* TAB 2: PORTFOLIO — real positions, orders & wallet */}
          {activeTab === "portfolio" && (
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Manual smoke check**

Run: `npm run dev:coindcx`
Open `http://localhost:5202`, click "SMC/ICT Confluence Backtest" in the left nav, confirm it loads and renders.

- [ ] **Step 7: Commit**

```bash
git add src/apps/coindcx/App.tsx
git commit -m "Wire SMC/ICT confluence backtest tab into CoinDCX app"
```
