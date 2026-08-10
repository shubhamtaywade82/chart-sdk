import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Sliders, Zap, X, Minimize2, Maximize2, Palette, Activity, CheckCircle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { Candle } from "../adapters/IDataAdapter";
import { AutoTuningADX, ADXSeriesResult, ADXOptimizationResult } from "../utils/autoTuningADX";

export interface ADXTheme {
  id: string;
  name: string;
  adxColor: string;
  diPlusColor: string;
  diMinusColor: string;
  thresholdColor: string;
}

export const ADX_THEMES: Record<string, ADXTheme> = {
  nightCyan: {
    id: "nightCyan",
    name: "Night Cyan",
    adxColor: "#00E5FF",
    diPlusColor: "#00F5A0",
    diMinusColor: "#FF495C",
    thresholdColor: "rgba(255, 255, 255, 0.4)",
  },
  graphiteGold: {
    id: "graphiteGold",
    name: "Graphite Gold",
    adxColor: "#FFD700",
    diPlusColor: "#00F5A0",
    diMinusColor: "#FF495C",
    thresholdColor: "rgba(255, 215, 0, 0.5)",
  },
  cleanLight: {
    id: "cleanLight",
    name: "Clean Light",
    adxColor: "#3B82F6",
    diPlusColor: "#10B981",
    diMinusColor: "#EF4444",
    thresholdColor: "rgba(100, 116, 139, 0.6)",
  },
};

export interface ADXLiveTunerProps {
  candles: Candle[];
  symbol: string;
  interval: string;
  onClose?: () => void;
}

export const ADXLiveTuner: React.FC<ADXLiveTunerProps> = ({ candles, symbol, interval, onClose }) => {
  const storageKey = `adx_tuner_${symbol.toLowerCase()}_${interval}`;

  const [length, setLength] = useState<number>(() => {
    const saved = localStorage.getItem(`${storageKey}_len`);
    return saved ? parseInt(saved, 10) || 14 : 14;
  });

  const [threshold, setThreshold] = useState<number>(() => {
    const saved = localStorage.getItem(`${storageKey}_thresh`);
    return saved ? parseFloat(saved) || 25 : 25;
  });

  const [themeId, setThemeId] = useState<string>(() => {
    return localStorage.getItem("adx_tuner_theme") || "nightCyan";
  });

  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"tune" | "optimizer" | "style">("tune");
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [optResult, setOptResult] = useState<ADXOptimizationResult | null>(null);

  const theme = ADX_THEMES[themeId] || ADX_THEMES.nightCyan;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Compute true Wilder ADX series
  const adxSeries = useMemo<ADXSeriesResult>(() => {
    return AutoTuningADX.calculate(candles, length);
  }, [candles, length]);

  // Persist tuned parameters & sync with on-chart series
  useEffect(() => {
    localStorage.setItem(`${storageKey}_len`, String(length));
    localStorage.setItem(`${storageKey}_thresh`, String(threshold));
    window.dispatchEvent(
      new CustomEvent("chart:apply_adx_tuner", {
        detail: { length, threshold, themeId },
      })
    );
  }, [storageKey, length, threshold, themeId]);

  useEffect(() => {
    localStorage.setItem("adx_tuner_theme", themeId);
  }, [themeId]);

  // Handle on-demand grid search optimization
  const runOptimization = useCallback(() => {
    if (!candles || candles.length < 30) return;
    setIsOptimizing(true);
    setTimeout(() => {
      const res = AutoTuningADX.optimize(candles, symbol, interval);
      setOptResult(res);
      setLength(res.bestLength);
      setThreshold(res.bestThreshold);
      setIsOptimizing(false);
    }, 50);
  }, [candles, symbol, interval]);

  // Render ADX Sub-Pane Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !adxSeries || adxSeries.adx.length < 2) return;
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

    // Draw reference threshold levels
    const maxVal = 70;
    const getY = (val: number) => h - (Math.min(maxVal, Math.max(0, val)) / maxVal) * (h - 20) - 10;

    // Background guide lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    [20, 40, 60].forEach((lvl) => {
      const y = getY(lvl);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    });

    // Tuned Threshold dotted line
    const threshY = getY(threshold);
    ctx.strokeStyle = theme.thresholdColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, threshY);
    ctx.lineTo(w, threshY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw lines for ADX, +DI, and -DI
    const pts = adxSeries.adx.length;
    const step = w / Math.max(1, pts - 1);

    const drawLine = (data: number[], color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = i * step;
        const y = getY(data[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawLine(adxSeries.diPlus, theme.diPlusColor, 1.2);
    drawLine(adxSeries.diMinus, theme.diMinusColor, 1.2);
    drawLine(adxSeries.adx, theme.adxColor, 2.2);
  }, [adxSeries, threshold, theme]);

  const lastADX = adxSeries.lastADX;
  const lastPDI = adxSeries.lastPlusDI;
  const lastMDI = adxSeries.lastMinusDI;
  const isTrending = lastADX >= threshold;
  const isBullish = lastPDI > lastMDI;

  return (
    <div
      style={{
        position: "absolute",
        top: "70px",
        right: "16px",
        width: isMinimized ? "260px" : "360px",
        background: "rgba(11, 15, 25, 0.95)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        border: "1px solid rgba(0, 229, 255, 0.25)",
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
          <Sliders size={14} color="#00E5FF" />
          <span style={{ fontSize: "12px", fontWeight: 800, letterSpacing: "0.5px" }}>
            ADX LIVE TUNER
          </span>
          <span
            style={{
              fontSize: "10px",
              padding: "1px 6px",
              borderRadius: "4px",
              background: isTrending ? "rgba(0, 245, 160, 0.2)" : "rgba(255, 73, 92, 0.2)",
              color: isTrending ? "#00F5A0" : "#FF495C",
              fontWeight: 700,
            }}
          >
            {isTrending ? (isBullish ? "UPTREND" : "DOWNTREND") : "RANGE"}
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
              { id: "tune", label: "Tuning" },
              { id: "optimizer", label: "Auto-Optimize" },
              { id: "style", label: "Themes" },
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
            {/* Live ADX / +DI / -DI Sub-Chart */}
            <div style={{ position: "relative", height: "90px", width: "100%" }}>
              <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
              <div
                style={{
                  position: "absolute",
                  top: "4px",
                  left: "6px",
                  display: "flex",
                  gap: "8px",
                  fontSize: "10px",
                  fontWeight: 700,
                }}
              >
                <span style={{ color: theme.adxColor }}>ADX: {lastADX}</span>
                <span style={{ color: theme.diPlusColor }}>+DI: {lastPDI}</span>
                <span style={{ color: theme.diMinusColor }}>-DI: {lastMDI}</span>
                <span style={{ color: "var(--text-muted)" }}>Thresh: {threshold}</span>
              </div>
            </div>

            {/* TAB 1: Live Interactive Tuning */}
            {activeTab === "tune" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
                    <span style={{ color: "var(--text-muted)" }}>ADX Period (Smoothing Length)</span>
                    <span style={{ color: "#00E5FF", fontWeight: 700 }}>{length} bars</span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={35}
                    step={1}
                    value={length}
                    onChange={(e) => setLength(parseInt(e.target.value, 10))}
                    style={{ width: "100%", accentColor: "#00E5FF", cursor: "pointer" }}
                  />
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
                    <span style={{ color: "var(--text-muted)" }}>Trend Threshold Level</span>
                    <span style={{ color: "#00F5A0", fontWeight: 700 }}>≥ {threshold} pts</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={50}
                    step={0.5}
                    value={threshold}
                    onChange={(e) => setThreshold(parseFloat(e.target.value))}
                    style={{ width: "100%", accentColor: "#00F5A0", cursor: "pointer" }}
                  />
                </div>

                {/* Preset quick buttons */}
                <div style={{ display: "flex", gap: "6px", marginTop: "2px" }}>
                  {[20, 25, 30, 35].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setThreshold(preset)}
                      style={{
                        flex: 1,
                        padding: "3px 6px",
                        fontSize: "10px",
                        fontWeight: 700,
                        borderRadius: "4px",
                        background: threshold === preset ? "rgba(0, 245, 160, 0.2)" : "rgba(255,255,255,0.05)",
                        border: threshold === preset ? "1px solid #00F5A0" : "1px solid rgba(255,255,255,0.1)",
                        color: threshold === preset ? "#00F5A0" : "var(--text-secondary)",
                        cursor: "pointer",
                      }}
                    >
                      {preset} TH
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("chart:apply_adx_tuner", {
                        detail: { length, threshold, themeId },
                      })
                    );
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    padding: "7px 12px",
                    borderRadius: "6px",
                    background: "linear-gradient(135deg, #00F5A0 0%, #00E5FF 100%)",
                    border: "none",
                    color: "#0A0D14",
                    fontSize: "11px",
                    fontWeight: 800,
                    cursor: "pointer",
                    marginTop: "4px",
                  }}
                >
                  <CheckCircle size={13} />
                  <span>APPLY PARAMETERS TO CHART</span>
                </button>
              </div>
            )}

            {/* TAB 2: Grid Search Auto-Optimizer */}
            {activeTab === "optimizer" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <button
                  onClick={runOptimization}
                  disabled={isOptimizing || candles.length < 30}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    padding: "7px 12px",
                    borderRadius: "6px",
                    background: "linear-gradient(135deg, #00F5A0 0%, #00E5FF 100%)",
                    border: "none",
                    color: "#0A0D14",
                    fontSize: "11px",
                    fontWeight: 800,
                    cursor: isOptimizing ? "wait" : "pointer",
                  }}
                >
                  <Zap size={13} />
                  {isOptimizing ? "OPTIMIZING..." : "⚡ RUN GRID SEARCH OPTIMIZATION"}
                </button>

                {optResult && (
                  <div
                    style={{
                      background: "rgba(0, 245, 160, 0.08)",
                      border: "1px solid rgba(0, 245, 160, 0.25)",
                      borderRadius: "6px",
                      padding: "8px 10px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      fontSize: "11px",
                    }}
                  >
                    <div style={{ fontWeight: 800, color: "#00F5A0" }}>
                      Optimal: Length {optResult.bestLength} · Threshold {optResult.bestThreshold}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)", fontSize: "10px" }}>
                      <span>Win Rate: {optResult.bestResult.winRate}%</span>
                      <span>Profit Factor: {optResult.bestResult.profitFactor}x</span>
                      <span>Trades: {optResult.bestResult.totalTrades}</span>
                    </div>
                    <button
                      onClick={() => {
                        setLength(optResult.bestLength);
                        setThreshold(optResult.bestThreshold);
                        window.dispatchEvent(
                          new CustomEvent("chart:apply_adx_tuner", {
                            detail: { length: optResult.bestLength, threshold: optResult.bestThreshold, themeId },
                          })
                        );
                      }}
                      style={{
                        padding: "5px 10px",
                        borderRadius: "4px",
                        background: "rgba(0, 245, 160, 0.2)",
                        border: "1px solid #00F5A0",
                        color: "#00F5A0",
                        fontSize: "10px",
                        fontWeight: 700,
                        cursor: "pointer",
                        marginTop: "2px",
                      }}
                    >
                      ⚡ APPLY WINNING SETTINGS TO CHART
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: Style & Theme Editor */}
            {activeTab === "style" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 600 }}>Palette Themes:</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
                  {Object.values(ADX_THEMES).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setThemeId(t.id)}
                      style={{
                        padding: "6px",
                        borderRadius: "6px",
                        background: themeId === t.id ? "rgba(0, 229, 255, 0.2)" : "rgba(255,255,255,0.05)",
                        border: themeId === t.id ? "1px solid #00E5FF" : "1px solid rgba(255,255,255,0.1)",
                        color: themeId === t.id ? "#00E5FF" : "var(--text-secondary)",
                        fontSize: "10px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
