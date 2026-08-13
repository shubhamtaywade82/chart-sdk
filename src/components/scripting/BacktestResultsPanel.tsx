import React, { useState } from "react";
import { ChevronDown, ChevronUp, X, TrendingUp, DollarSign, Activity, Percent, ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { StrategyEquityPoint, StrategyStats, StrategyTrade } from "../../scripting/types";

interface BacktestResultsPanelProps {
  strategyName: string;
  stats: StrategyStats;
  trades: StrategyTrade[];
  equityCurve: StrategyEquityPoint[];
  onClose: () => void;
}

export const BacktestResultsPanel: React.FC<BacktestResultsPanelProps> = ({
  strategyName,
  stats,
  trades,
  equityCurve,
  onClose,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<"summary" | "trades">("summary");

  const isProfit = stats.netProfit >= 0;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        background: "#0E131F",
        borderTop: "1px solid rgba(0, 229, 255, 0.3)",
        boxShadow: "0 -8px 24px rgba(0, 0, 0, 0.6)",
        display: "flex",
        flexDirection: "column",
        maxHeight: isCollapsed ? "42px" : "280px",
        transition: "max-height 0.25s ease",
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          background: "#141A29",
          borderBottom: isCollapsed ? "none" : "1px solid rgba(255, 255, 255, 0.08)",
          minHeight: "40px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "#00E5FF", letterSpacing: "0.5px" }}>
            STRATEGY TESTER: {strategyName.toUpperCase()}
          </span>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: isProfit ? "#00F5A0" : "#FF495C",
              background: isProfit ? "rgba(0, 245, 160, 0.15)" : "rgba(255, 73, 92, 0.15)",
              padding: "2px 8px",
              borderRadius: "4px",
            }}
          >
            {isProfit ? "+" : ""}${stats.netProfit.toLocaleString()} ({isProfit ? "+" : ""}{stats.netProfitPercent}%)
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {!isCollapsed && (
            <div style={{ display: "flex", background: "rgba(0,0,0,0.3)", borderRadius: "4px", padding: "2px" }}>
              <button
                onClick={() => setActiveTab("summary")}
                style={{
                  background: activeTab === "summary" ? "rgba(0, 229, 255, 0.2)" : "transparent",
                  color: activeTab === "summary" ? "#00E5FF" : "rgba(255,255,255,0.6)",
                  border: "none",
                  padding: "2px 8px",
                  fontSize: "10px",
                  fontWeight: 700,
                  borderRadius: "3px",
                  cursor: "pointer",
                }}
              >
                METRICS
              </button>
              <button
                onClick={() => setActiveTab("trades")}
                style={{
                  background: activeTab === "trades" ? "rgba(0, 229, 255, 0.2)" : "transparent",
                  color: activeTab === "trades" ? "#00E5FF" : "rgba(255,255,255,0.6)",
                  border: "none",
                  padding: "2px 8px",
                  fontSize: "10px",
                  fontWeight: 700,
                  borderRadius: "3px",
                  cursor: "pointer",
                }}
              >
                TRADE LOG ({trades.length})
              </button>
            </div>
          )}

          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            style={{
              background: "transparent",
              color: "rgba(255,255,255,0.6)",
              border: "none",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            {isCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              color: "rgba(255,255,255,0.6)",
              border: "none",
              cursor: "pointer",
              padding: "4px",
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body Content */}
      {!isCollapsed && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          {activeTab === "summary" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px" }}>
              {[
                { label: "Net Profit", val: `$${stats.netProfit}`, sub: `${stats.netProfitPercent}%`, good: isProfit },
                { label: "Win Rate", val: `${stats.winRate}%`, sub: `${stats.winningTrades}W / ${stats.losingTrades}L`, good: stats.winRate >= 50 },
                { label: "Profit Factor", val: stats.profitFactor.toFixed(2), sub: "Gross W/L", good: stats.profitFactor >= 1.5 },
                { label: "Max Drawdown", val: `${stats.maxDrawdownPercent}%`, sub: "Peak to Trough", good: stats.maxDrawdownPercent < 15 },
                { label: "Sharpe Ratio", val: stats.sharpeRatio.toFixed(2), sub: "Annualized", good: stats.sharpeRatio >= 1.0 },
                { label: "Total Trades", val: `${stats.totalTrades}`, sub: "Executed", good: true },
                { label: "Avg Trade Profit", val: `$${stats.averageTradeProfit}`, sub: "Per Bar", good: stats.averageTradeProfit > 0 },
              ].map((card) => (
                <div
                  key={card.label}
                  style={{
                    background: "rgba(255, 255, 255, 0.03)",
                    border: "1px solid rgba(255, 255, 255, 0.06)",
                    borderRadius: "6px",
                    padding: "8px 10px",
                  }}
                >
                  <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>{card.label}</div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: card.good ? "#00F5A0" : "#FF495C", marginTop: "2px" }}>
                    {card.val}
                  </div>
                  <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.4)", marginTop: "2px" }}>{card.sub}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", textAlign: "left" }}>
                <thead>
                  <tr style={{ color: "rgba(255,255,255,0.4)", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "4px" }}>
                    <th style={{ padding: "4px 8px" }}>#</th>
                    <th style={{ padding: "4px 8px" }}>Side</th>
                    <th style={{ padding: "4px 8px" }}>Entry Time</th>
                    <th style={{ padding: "4px 8px" }}>Entry Price</th>
                    <th style={{ padding: "4px 8px" }}>Exit Time</th>
                    <th style={{ padding: "4px 8px" }}>Exit Price</th>
                    <th style={{ padding: "4px 8px" }}>Profit ($)</th>
                    <th style={{ padding: "4px 8px" }}>ROI (%)</th>
                    <th style={{ padding: "4px 8px" }}>Cum. Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => {
                    const isWin = t.profit >= 0;
                    return (
                      <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                        <td style={{ padding: "4px 8px", color: "rgba(255,255,255,0.5)" }}>{t.id}</td>
                        <td style={{ padding: "4px 8px", fontWeight: 700, color: t.side === "LONG" ? "#00F5A0" : "#FF495C" }}>
                          {t.side}
                        </td>
                        <td style={{ padding: "4px 8px", color: "rgba(255,255,255,0.7)" }}>
                          {new Date(t.entryTime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td style={{ padding: "4px 8px" }}>${t.entryPrice.toFixed(2)}</td>
                        <td style={{ padding: "4px 8px", color: "rgba(255,255,255,0.7)" }}>
                          {new Date(t.exitTime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td style={{ padding: "4px 8px" }}>${t.exitPrice.toFixed(2)}</td>
                        <td style={{ padding: "4px 8px", fontWeight: 700, color: isWin ? "#00F5A0" : "#FF495C" }}>
                          {isWin ? "+" : ""}${t.profit.toFixed(2)}
                        </td>
                        <td style={{ padding: "4px 8px", fontWeight: 600, color: isWin ? "#00F5A0" : "#FF495C" }}>
                          {isWin ? "+" : ""}{t.profitPercent}%
                        </td>
                        <td style={{ padding: "4px 8px", color: t.cumulativeProfit >= 0 ? "#00F5A0" : "#FF495C" }}>
                          ${t.cumulativeProfit.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
