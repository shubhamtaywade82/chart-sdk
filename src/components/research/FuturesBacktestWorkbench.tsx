import React, { useState, useEffect } from "react";
import { Play, TrendingUp, TrendingDown, DollarSign, Activity, Shield, RefreshCw, Download, Layers, BarChart2 } from "lucide-react";
import type { IDataAdapter, Candle } from "../../adapters/IDataAdapter";
import { AdaptiveSupertrend } from "../../utils/adaptiveSupertrend";

interface FuturesBacktestProps {
  symbol: string;
  adapter?: IDataAdapter;
}

export const FuturesBacktestWorkbench: React.FC<FuturesBacktestProps> = ({ symbol, adapter }) => {
  const [selectedSymbol, setSelectedSymbol] = useState(symbol || "solusdt");
  const [interval, setInterval] = useState("15m");
  const [leverage, setLeverage] = useState(10);
  const [riskPct, setRiskPct] = useState(2);
  const [takeProfitR, setTakeProfitR] = useState(2.0);
  const [stopLossPct, setStopLossPct] = useState(1.5);
  const [initialBalance, setInitialBalance] = useState(10000);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (symbol) setSelectedSymbol(symbol);
  }, [symbol]);

  const runBacktest = async () => {
    setLoading(true);
    try {
      let dataLoaded = false;

      // 1. Try backend endpoint first
      try {
        const res = await fetch("/api/futures/backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: selectedSymbol,
            interval,
            leverage,
            riskPct,
            takeProfitR,
            stopLossPct,
            initialBalance,
          }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.data && Array.isArray(json.data.trades) && json.data.trades.length > 0) {
            setResult(json.data);
            dataLoaded = true;
          }
        }
      } catch (err) {
        // Fallback to client-side quantitative simulation
      }

      // 2. High-performance client-side simulation on real candles
      if (!dataLoaded) {
        let candles: Candle[] = [];

        if (adapter) {
          candles = await adapter.fetchCandles(selectedSymbol, interval, 500);
        }

        // Direct Binance API fallback if adapter has no cached candles
        if (!candles || candles.length < 20) {
          try {
            const normSymbol = selectedSymbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
            const binanceSym = normSymbol.endsWith("USDT") ? normSymbol : `${normSymbol}USDT`;
            const binanceInterval = interval === "1D" ? "1d" : interval;
            const direct = await fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${binanceInterval}&limit=500`);
            if (direct.ok) {
              const rawKlines = await direct.json();
              candles = rawKlines.map((k: any) => ({
                time: Math.floor(k[0] / 1000),
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5]),
              }));
            }
          } catch (e) {
            console.warn("Direct candle fetch fallback:", e);
          }
        }

        if (candles.length >= 20) {
          const engine = new AdaptiveSupertrend(10, 3.0, 85, 150, 25, 1.0, 6.0);
          const bt = engine.runBacktest(candles, {
            initialEquity: initialBalance,
            riskPctPerTrade: riskPct / 100,
            takeProfitR,
            useChopFilter: true,
            minConfidence: 65,
          });

          let bal = initialBalance;
          const peak = initialBalance;
          const curve: { time: number; equity: number }[] = [
            { time: candles[0]?.time || 0, equity: initialBalance },
          ];

          const futuresTrades = bt.trades.map((t, idx) => {
            const riskAmount = bal * (riskPct / 100);
            const stopDistPct = Math.max(0.005, Math.abs(t.entryPrice - t.stopPrice) / t.entryPrice);
            const notional = (riskAmount / stopDistPct) * (leverage / 10);
            const margin = notional / leverage;
            const levPnl = (t.pnlPct / 100) * notional;
            bal += levPnl;

            curve.push({
              time: t.exitTime,
              equity: Number(bal.toFixed(2)),
            });

            return {
              id: idx + 1,
              side: t.type === "BUY" ? "LONG" : "SHORT",
              entryPrice: t.entryPrice,
              exitPrice: t.exitPrice,
              margin: Number(margin.toFixed(2)),
              pnl: Number(levPnl.toFixed(2)),
              returnPct: Number((t.pnlPct * leverage).toFixed(2)),
              exitReason: t.exitReason,
            };
          });

          const winners = futuresTrades.filter((t) => t.pnl > 0).length;
          const losers = futuresTrades.filter((t) => t.pnl <= 0).length;
          const grossWin = futuresTrades.filter((t) => t.pnl > 0).reduce((a, b) => a + b.pnl, 0);
          const grossLoss = Math.abs(futuresTrades.filter((t) => t.pnl < 0).reduce((a, b) => a + b.pnl, 0));
          const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 5.0 : 1.0;

          setResult({
            symbol: `${selectedSymbol.toUpperCase()} Perpetual Futures`,
            netPnlUsdt: Number((bal - initialBalance).toFixed(2)),
            finalBalance: Number(bal.toFixed(2)),
            winRatePct: futuresTrades.length > 0 ? Number(((winners / futuresTrades.length) * 100).toFixed(1)) : 0,
            winnersCount: winners,
            losersCount: losers,
            totalTrades: futuresTrades.length,
            profitFactor: Number(pf.toFixed(2)),
            maxDrawdownPct: bt.maxDrawdownPct,
            equityCurve: curve,
            trades: futuresTrades,
          });
        }
      }
    } catch (e) {
      console.error("Futures Backtest error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runBacktest();
  }, [selectedSymbol, interval, leverage, riskPct, takeProfitR]);

  const exportCSV = () => {
    if (!result || !result.trades || result.trades.length === 0) return;
    const headers = "Trade ID,Side,Entry Price,Exit Price,Margin (USDT),PnL (USDT),Return %,Exit Reason";
    const rows = result.trades.map(
      (t: any) => `${t.id},${t.side},${t.entryPrice},${t.exitPrice},${t.margin},${t.pnl},${t.returnPct},"${t.exitReason}"`
    );
    const blob = new Blob([[headers, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Futures_Backtest_${selectedSymbol}_${interval}_${leverage}x.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "20px" }} className="glass-panel">
      {/* 1. Control Bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
            <Activity size={20} color="var(--accent-green)" />
            Crypto Futures Quantitative Backtest Workbench
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
            Backtest SMC & ICT Smart Money setups on USD-M Futures with leverage, margin, and risk controls.
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
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)", color: "#fff", padding: "6px 10px", borderRadius: "6px", fontSize: "12px" }}
          >
            <option value={1}>1x Leverage (Spot)</option>
            <option value={5}>5x Leverage</option>
            <option value={10}>10x Leverage</option>
            <option value={20}>20x Leverage</option>
            <option value={50}>50x Leverage</option>
          </select>

          <select
            value={takeProfitR}
            onChange={(e) => setTakeProfitR(Number(e.target.value))}
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-color)", color: "#fff", padding: "6px 10px", borderRadius: "6px", fontSize: "12px" }}
          >
            <option value={1.5}>1.5R Target</option>
            <option value={2.0}>2.0R Target</option>
            <option value={3.0}>3.0R Target</option>
          </select>

          <button
            onClick={runBacktest}
            disabled={loading}
            style={{ background: "var(--accent-green)", color: "#0A0D14", border: "none", padding: "8px 16px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            <span>RUN BACKTEST</span>
          </button>

          {result && result.trades && result.trades.length > 0 && (
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

      {/* 2. Metrics Cards */}
      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
          <div className="glass-card" style={{ padding: "14px", borderRadius: "8px" }}>
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>NET REALIZED PNL</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: result.netPnlUsdt >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
              {result.netPnlUsdt >= 0 ? "+" : ""}${result.netPnlUsdt.toLocaleString()}
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>
              Final: ${result.finalBalance.toLocaleString()} ({((result.netPnlUsdt / initialBalance) * 100).toFixed(1)}%)
            </div>
          </div>

          <div className="glass-card" style={{ padding: "14px", borderRadius: "8px" }}>
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>WIN RATE</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--accent-cyan)" }}>
              {result.winRatePct}%
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>
              {result.winnersCount} W / {result.losersCount} L ({result.totalTrades} total)
            </div>
          </div>

          <div className="glass-card" style={{ padding: "14px", borderRadius: "8px" }}>
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>PROFIT FACTOR</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "#FFD700" }}>
              {result.profitFactor}
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>
              Gross Win / Gross Loss
            </div>
          </div>

          <div className="glass-card" style={{ padding: "14px", borderRadius: "8px" }}>
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>MAX DRAWDOWN</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--accent-red)" }}>
              -{result.maxDrawdownPct}%
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>
              Peak-to-Trough
            </div>
          </div>
        </div>
      )}

      {/* 3. Equity Curve Visualization */}
      {result && result.equityCurve && result.equityCurve.length > 1 && (
        <div className="glass-card" style={{ padding: "14px", borderRadius: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
              <TrendingUp size={14} color="#00F5A0" />
              <span>Cumulative Equity Growth Curve ({leverage}x Leverage)</span>
            </div>
            <span style={{ fontSize: "11px", color: "#00F5A0", fontWeight: 700 }}>
              Peak: ${Math.max(...result.equityCurve.map((c: any) => c.equity)).toLocaleString()}
            </span>
          </div>

          <div style={{ height: "120px", width: "100%", display: "flex", alignItems: "flex-end", gap: "2px", background: "rgba(0,0,0,0.25)", padding: "8px", borderRadius: "6px", overflowX: "auto" }}>
            {(() => {
              const minEq = Math.min(...result.equityCurve.map((c: any) => c.equity));
              const maxEq = Math.max(...result.equityCurve.map((c: any) => c.equity));
              const range = Math.max(1, maxEq - minEq);
              return result.equityCurve.map((pt: any, i: number) => {
                const heightPct = Math.max(8, ((pt.equity - minEq) / range) * 100);
                const isGain = pt.equity >= initialBalance;
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

      {/* 4. Trade Log Table */}
      {result && result.trades && result.trades.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-secondary)" }}>
            Backtested Futures Trade History ({result.trades.length} trades · {leverage}x Leverage)
          </div>
          <div style={{ overflowX: "auto", maxHeight: "350px", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-muted)", borderBottom: "1px solid var(--border-color)" }}>
                  <th style={{ padding: "10px" }}>ID</th>
                  <th style={{ padding: "10px" }}>SIDE</th>
                  <th style={{ padding: "10px" }}>ENTRY</th>
                  <th style={{ padding: "10px" }}>EXIT</th>
                  <th style={{ padding: "10px" }}>MARGIN</th>
                  <th style={{ padding: "10px" }}>PNL (USDT)</th>
                  <th style={{ padding: "10px" }}>RETURN %</th>
                  <th style={{ padding: "10px" }}>REASON</th>
                </tr>
              </thead>
              <tbody>
                {result.trades.map((t: any) => (
                  <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <td style={{ padding: "10px", fontFamily: "var(--font-mono)" }}>{t.id}</td>
                    <td style={{ padding: "10px", fontWeight: 700, color: t.side === "LONG" ? "var(--accent-green)" : "var(--accent-red)" }}>
                      {t.side}
                    </td>
                    <td style={{ padding: "10px", fontFamily: "var(--font-mono)" }}>${t.entryPrice.toLocaleString()}</td>
                    <td style={{ padding: "10px", fontFamily: "var(--font-mono)" }}>${t.exitPrice.toLocaleString()}</td>
                    <td style={{ padding: "10px", fontFamily: "var(--font-mono)" }}>${t.margin.toFixed(2)}</td>
                    <td style={{ padding: "10px", fontWeight: 700, color: t.pnl >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                      {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                    </td>
                    <td style={{ padding: "10px", fontWeight: 700, color: t.returnPct >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                      {t.returnPct >= 0 ? "+" : ""}{t.returnPct}%
                    </td>
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
