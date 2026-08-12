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
