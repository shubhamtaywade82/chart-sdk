import React, { useState, useMemo, useRef, useEffect } from "react";
import { Layers, Zap, X, Minimize2, Maximize2, Shield, Activity, TrendingUp, TrendingDown, Target, ArrowRight } from "lucide-react";
import type { Candle } from "../adapters/IDataAdapter";
import { runRiftAnalysis, RiftAnalysisResult } from "../utils/riftPaper";
import { RiftConfig, DEFAULT_RIFT_CONFIG } from "../utils/riftEngine";

export interface RiftDashboardProps {
  candles: Candle[];
  symbol: string;
  interval: string;
  onClose?: () => void;
}

export const RiftDashboard: React.FC<RiftDashboardProps> = ({ candles, symbol, interval, onClose }) => {
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"telemetry" | "trades" | "profile" | "settings">("telemetry");

  const [riskMode, setRiskMode] = useState<"atr" | "structure">(() => {
    return (localStorage.getItem("rift_risk_mode") as any) || "atr";
  });
  const [cvdGate, setCvdGate] = useState<boolean>(() => {
    return localStorage.getItem("rift_cvd_gate") !== "false";
  });
  const [deltaConfirm, setDeltaConfirm] = useState<boolean>(() => {
    return localStorage.getItem("rift_delta_confirm") !== "false";
  });

  const config: RiftConfig = useMemo(() => {
    return {
      ...DEFAULT_RIFT_CONFIG,
      riskMode,
      cvdGate,
      deltaConfirm,
    };
  }, [riskMode, cvdGate, deltaConfirm]);

  const result: RiftAnalysisResult = useMemo(() => {
    return runRiftAnalysis(candles, symbol, config);
  }, [candles, symbol, config]);

  const { stats, latestSignal, tradeBoxes, winRate, profitFactor, netProfitPct, totalTrades, winningTrades, losingTrades } = result;

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Render margin profile mini canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stats) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const minPrice = stats.val * 0.995;
    const maxPrice = stats.vah * 1.005;
    const range = Math.max(0.0001, maxPrice - minPrice);
    const getY = (p: number) => h - ((p - minPrice) / range) * (h - 16) - 8;

    // Draw Value Area Shaded Box
    const vahY = getY(stats.vah);
    const valY = getY(stats.val);
    ctx.fillStyle = "rgba(0, 229, 255, 0.05)";
    ctx.fillRect(0, vahY, w, valY - vahY);

    // Draw POC Line (Gold)
    const pocY = getY(stats.poc);
    ctx.strokeStyle = "#FFD700";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, pocY);
    ctx.lineTo(w, pocY);
    ctx.stroke();

    // Draw POV Line (Orange - Point of Void)
    if (stats.pov) {
      const povY = getY(stats.pov);
      ctx.strokeStyle = "#FF8C00";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, povY);
      ctx.lineTo(w, povY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [stats]);

  return (
    <div
      style={{
        position: "absolute",
        top: "70px",
        left: "16px",
        width: isMinimized ? "260px" : "380px",
        background: "rgba(11, 15, 25, 0.95)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        border: "1px solid rgba(0, 229, 255, 0.3)",
        borderRadius: "10px",
        boxShadow: "0 12px 36px rgba(0, 0, 0, 0.6)",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "var(--font-sans, system-ui)",
        color: "#FFFFFF",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: "rgba(255, 255, 255, 0.04)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Zap size={14} color="#00E5FF" />
          <span style={{ fontSize: "12px", fontWeight: 800, letterSpacing: "0.5px" }}>
            RIFT [RAMPAGE]
          </span>
          <span
            style={{
              fontSize: "10px",
              padding: "1px 6px",
              borderRadius: "4px",
              background: stats && stats.deltaPct >= 0 ? "rgba(0, 245, 160, 0.2)" : "rgba(255, 73, 92, 0.2)",
              color: stats && stats.deltaPct >= 0 ? "#00F5A0" : "#FF495C",
              fontWeight: 700,
            }}
          >
            {stats ? `DELTA ${stats.deltaPct >= 0 ? "+" : ""}${stats.deltaPct.toFixed(1)}%` : "WARMING"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
            title={isMinimized ? "Expand" : "Minimize"}
          >
            {isMinimized ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
              title="Close"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Navigation Tabs */}
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
              background: "rgba(0, 0, 0, 0.2)",
            }}
          >
            {[
              { id: "telemetry", label: "Telemetry" },
              { id: "profile", label: "Profile / POV" },
              { id: "trades", label: `Trades (${tradeBoxes.length})` },
              { id: "settings", label: "Settings" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  fontSize: "11px",
                  fontWeight: activeTab === tab.id ? 700 : 500,
                  color: activeTab === tab.id ? "#00E5FF" : "var(--text-muted)",
                  background: activeTab === tab.id ? "rgba(0, 229, 255, 0.1)" : "transparent",
                  border: "none",
                  borderBottom: activeTab === tab.id ? "2px solid #00E5FF" : "2px solid transparent",
                  cursor: "pointer",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {/* TAB 1: Live Telemetry & The Three Hunts */}
            {activeTab === "telemetry" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {/* Developing Levels Grid */}
                {stats && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div style={{ background: "rgba(255, 215, 0, 0.08)", border: "1px solid rgba(255, 215, 0, 0.25)", padding: "8px", borderRadius: "6px" }}>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>POINT OF CONTROL (POC)</div>
                      <div style={{ fontSize: "15px", fontWeight: 800, color: "#FFD700", marginTop: "2px" }}>{stats.poc.toFixed(2)}</div>
                    </div>

                    <div style={{ background: "rgba(255, 140, 0, 0.08)", border: "1px solid rgba(255, 140, 0, 0.3)", padding: "8px", borderRadius: "6px" }}>
                      <div style={{ fontSize: "10px", color: "#FFA500", fontWeight: 700 }}>POINT OF VOID (POV)</div>
                      <div style={{ fontSize: "15px", fontWeight: 800, color: "#FF8C00", marginTop: "2px" }}>
                        {stats.pov ? stats.pov.toFixed(2) : "N/A"}
                      </div>
                    </div>

                    <div style={{ background: "rgba(0, 229, 255, 0.05)", border: "1px solid rgba(0, 229, 255, 0.15)", padding: "8px", borderRadius: "6px" }}>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>VALUE AREA HIGH (VAH)</div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#00E5FF", marginTop: "2px" }}>{stats.vah.toFixed(2)}</div>
                    </div>

                    <div style={{ background: "rgba(255, 73, 92, 0.05)", border: "1px solid rgba(255, 73, 92, 0.15)", padding: "8px", borderRadius: "6px" }}>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700 }}>VALUE AREA LOW (VAL)</div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#FF495C", marginTop: "2px" }}>{stats.val.toFixed(2)}</div>
                    </div>
                  </div>
                )}

                {/* Latest Hunt Signal Chip */}
                {latestSignal ? (
                  <div
                    style={{
                      background: latestSignal.side === "LONG" ? "rgba(0, 245, 160, 0.1)" : "rgba(255, 73, 92, 0.1)",
                      border: `1px solid ${latestSignal.side === "LONG" ? "#00F5A0" : "#FF495C"}`,
                      borderRadius: "6px",
                      padding: "8px 10px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "11px", fontWeight: 800, color: latestSignal.side === "LONG" ? "#00F5A0" : "#FF495C" }}>
                        {latestSignal.side} · {latestSignal.kind} @ {latestSignal.node}
                      </span>
                      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                        {new Date(latestSignal.time * 1000).toLocaleTimeString()}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--text-secondary)" }}>
                      <span>Entry: {latestSignal.entry.toFixed(2)}</span>
                      <span>Stop: {latestSignal.stop.toFixed(2)}</span>
                      <span>Target: {latestSignal.target.toFixed(2)}</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "center", padding: "8px" }}>
                    Scanning for Sweep & Reclaim / POC Bounce / POV Void...
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: Margin Profile & POV Preview */}
            {activeTab === "profile" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ position: "relative", height: "130px", width: "100%", background: "rgba(0,0,0,0.3)", borderRadius: "6px" }}>
                  <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
                  {stats && (
                    <div style={{ position: "absolute", bottom: "4px", left: "6px", fontSize: "10px", color: "var(--text-muted)" }}>
                      CVD: {stats.cvd.toFixed(0)} | Total Vol: {stats.totalVol.toFixed(0)}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: Frozen Trade Boxes & Performance */}
            {activeTab === "trades" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
                  <div style={{ background: "rgba(255,255,255,0.04)", padding: "6px", borderRadius: "4px", textAlign: "center" }}>
                    <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>WIN RATE</div>
                    <div style={{ fontSize: "13px", fontWeight: 800, color: winRate >= 50 ? "#00F5A0" : "#FF495C" }}>{winRate}%</div>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.04)", padding: "6px", borderRadius: "4px", textAlign: "center" }}>
                    <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>PROFIT FACTOR</div>
                    <div style={{ fontSize: "13px", fontWeight: 800, color: "#FFD700" }}>{profitFactor}x</div>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.04)", padding: "6px", borderRadius: "4px", textAlign: "center" }}>
                    <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>NET RETURN</div>
                    <div style={{ fontSize: "13px", fontWeight: 800, color: netProfitPct >= 0 ? "#00F5A0" : "#FF495C" }}>
                      {netProfitPct >= 0 ? "+" : ""}{netProfitPct}%
                    </div>
                  </div>
                </div>

                <div style={{ maxHeight: "140px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
                  {tradeBoxes.slice(-6).reverse().map((b) => (
                    <div
                      key={b.id}
                      style={{
                        padding: "6px",
                        borderRadius: "4px",
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        fontSize: "10px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span style={{ fontWeight: 700, color: b.side === "LONG" ? "#00F5A0" : "#FF495C" }}>
                        {b.side} · {b.kind}
                      </span>
                      <span
                        style={{
                          padding: "1px 4px",
                          borderRadius: "3px",
                          fontWeight: 800,
                          fontSize: "9px",
                          background: b.state === "TP_HIT" ? "rgba(0, 245, 160, 0.2)" : b.state === "SL_HIT" ? "rgba(255, 73, 92, 0.2)" : "rgba(255,255,255,0.1)",
                          color: b.state === "TP_HIT" ? "#00F5A0" : b.state === "SL_HIT" ? "#FF495C" : "var(--text-secondary)",
                        }}
                      >
                        {b.state} ({b.pnlPct !== undefined ? `${b.pnlPct >= 0 ? "+" : ""}${b.pnlPct}%` : "LIVE"})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 4: Settings & Risk Framing */}
            {activeTab === "settings" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px" }}>
                  <span style={{ color: "var(--text-muted)" }}>Risk Framing Mode:</span>
                  <button
                    onClick={() => {
                      const next = riskMode === "atr" ? "structure" : "atr";
                      setRiskMode(next);
                      localStorage.setItem("rift_risk_mode", next);
                    }}
                    style={{
                      padding: "3px 8px",
                      borderRadius: "4px",
                      background: "rgba(0, 229, 255, 0.15)",
                      border: "1px solid #00E5FF",
                      color: "#00E5FF",
                      fontSize: "10px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {riskMode.toUpperCase()} MODE
                  </button>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px" }}>
                  <span style={{ color: "var(--text-muted)" }}>CVD Divergence Gate:</span>
                  <button
                    onClick={() => {
                      const next = !cvdGate;
                      setCvdGate(next);
                      localStorage.setItem("rift_cvd_gate", String(next));
                    }}
                    style={{
                      padding: "3px 8px",
                      borderRadius: "4px",
                      background: cvdGate ? "rgba(0, 245, 160, 0.15)" : "rgba(255,255,255,0.05)",
                      border: cvdGate ? "1px solid #00F5A0" : "1px solid rgba(255,255,255,0.1)",
                      color: cvdGate ? "#00F5A0" : "var(--text-muted)",
                      fontSize: "10px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {cvdGate ? "ENABLED" : "OFF"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
