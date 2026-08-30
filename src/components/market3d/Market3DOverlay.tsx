import React from "react";
import { Candle3D, Timeframe3D } from "./types";
import { formatPrice, formatVolume, formatFullTimestamp } from "./dataService";

interface Market3DOverlayProps {
  timeframe: Timeframe3D;
  setTimeframe: (tf: Timeframe3D) => void;
  candleCount: number;
  setCandleCount: (count: number) => void;
  showVolume: boolean;
  setShowVolume: (val: boolean) => void;
  showDepth: boolean;
  setShowDepth: (val: boolean) => void;
  showFlow: boolean;
  setShowFlow: (val: boolean) => void;
  autoOrbit: boolean;
  setAutoOrbit: (val: boolean) => void;
  enableBloom: boolean;
  setEnableBloom: (val: boolean) => void;
  showBook: boolean;
  setShowBook: (val: boolean) => void;
  showTape: boolean;
  setShowTape: (val: boolean) => void;
  onResetCamera: () => void;
  activeCandle: Candle3D | null;
  hoveredIndex: number | null;
  tooltipPos: { x: number; y: number } | null;
  isLoading: boolean;
  isFatal: boolean;
}

export function Market3DOverlay({
  timeframe,
  setTimeframe,
  candleCount,
  setCandleCount,
  showVolume,
  setShowVolume,
  showDepth,
  setShowDepth,
  showFlow,
  setShowFlow,
  autoOrbit,
  setAutoOrbit,
  enableBloom,
  setEnableBloom,
  showBook,
  setShowBook,
  showTape,
  setShowTape,
  onResetCamera,
  activeCandle,
  hoveredIndex,
  tooltipPos,
  isLoading,
  isFatal,
}: Market3DOverlayProps) {
  const timeframes: Timeframe3D[] = ["15m", "1h", "4h", "1d"];

  return (
    <>
      {/* Control toolbar */}
      <div className="m3-toolbar">
        <div className="m3-toolbar-group">
          <span className="m3-toolbar-label">INTERVAL</span>
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`m3-tf-btn ${timeframe === tf ? "active" : ""}`}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="m3-toolbar-divider" />

        <div className="m3-toolbar-group">
          <span className="m3-toolbar-label" style={{ marginRight: 2 }}>BARS</span>
          <input
            type="range"
            min={60}
            max={240}
            step={20}
            value={candleCount}
            onChange={(e) => setCandleCount(Number(e.target.value))}
            style={{ accentColor: "#00e0a4", width: 80, height: 4, cursor: "pointer" }}
          />
          <span className="m3-bars-count">{candleCount}</span>
        </div>

        <div className="m3-toolbar-divider" />

        <div className="m3-checks">
          <label className="m3-check-label">
            <input type="checkbox" checked={showVolume} onChange={(e) => setShowVolume(e.target.checked)} />
            VOL
          </label>
          <label className="m3-check-label">
            <input type="checkbox" checked={showDepth} onChange={(e) => setShowDepth(e.target.checked)} />
            DEPTH
          </label>
          <label className="m3-check-label">
            <input type="checkbox" checked={showFlow} onChange={(e) => setShowFlow(e.target.checked)} />
            FLOW
          </label>
          <label className="m3-check-label">
            <input type="checkbox" checked={autoOrbit} onChange={(e) => setAutoOrbit(e.target.checked)} />
            ORBIT
          </label>
          <label className="m3-check-label">
            <input type="checkbox" checked={enableBloom} onChange={(e) => setEnableBloom(e.target.checked)} />
            GLOW
          </label>
        </div>

        <div className="m3-toolbar-divider" />

        <div className="m3-toolbar-group">
          <button onClick={() => setShowBook(!showBook)} className={`m3-toggle-btn ${showBook ? "active" : ""}`}>
            BOOK
          </button>
          <button onClick={() => setShowTape(!showTape)} className={`m3-toggle-btn ${showTape ? "active" : ""}`}>
            TAPE
          </button>
          <button onClick={onResetCamera} className="m3-toggle-btn">
            ⟲ VIEW
          </button>
        </div>
      </div>

      {/* Candle info card */}
      {activeCandle && (
        <div className="m3-candle-card">
          <div className="m3-candle-card-head">
            <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700 }}>{hoveredIndex !== null ? `#${hoveredIndex + 1} INSPECT` : "LATEST"}</span>
            <span style={{ fontSize: 9, color: "#64748b" }}>{formatFullTimestamp(activeCandle.t)}</span>
          </div>
          <div className="m3-candle-grid">
            <span className="label">OPEN:</span><span className="val">{formatPrice(activeCandle.o)}</span>
            <span className="label">HIGH:</span><span className="val" style={{ color: "#00e0a4" }}>{formatPrice(activeCandle.h)}</span>
            <span className="label">LOW:</span><span className="val" style={{ color: "#ff4f6e" }}>{formatPrice(activeCandle.l)}</span>
            <span className="label">CLOSE:</span><span className="val" style={{ fontWeight: 700, color: "#fff" }}>{formatPrice(activeCandle.c)}</span>
            <span className="label">VOLUME:</span><span className="val" style={{ color: "#bae6fd" }}>{formatVolume(activeCandle.v)}</span>
          </div>
        </div>
      )}

      {/* Hover tooltip */}
      {hoveredIndex !== null && tooltipPos && activeCandle && (
        <div
          className="m3-tooltip"
          style={{
            left: Math.min(window.innerWidth - 200, tooltipPos.x + 15),
            top: Math.max(10, tooltipPos.y - 80),
            borderLeftWidth: "3px",
            borderLeftStyle: "solid",
            borderLeftColor: activeCandle.c >= activeCandle.o ? "#00e0a4" : "#ff4f6e",
          }}
        >
          <div className="m3-tooltip-head">
            <span>#{hoveredIndex + 1}</span>
            <span>{formatFullTimestamp(activeCandle.t)}</span>
          </div>
          <div className="m3-tooltip-row"><span style={{ color: "#64748b" }}>O:</span><span>{formatPrice(activeCandle.o)}</span></div>
          <div className="m3-tooltip-row"><span style={{ color: "#64748b" }}>H:</span><span style={{ color: "#00e0a4" }}>{formatPrice(activeCandle.h)}</span></div>
          <div className="m3-tooltip-row"><span style={{ color: "#64748b" }}>L:</span><span style={{ color: "#ff4f6e" }}>{formatPrice(activeCandle.l)}</span></div>
          <div className="m3-tooltip-row"><span style={{ color: "#64748b" }}>C:</span><span style={{ fontWeight: 700 }}>{formatPrice(activeCandle.c)}</span></div>
          <div className="m3-tooltip-row"><span style={{ color: "#64748b" }}>VOL:</span><span style={{ color: "#bae6fd" }}>{formatVolume(activeCandle.v)}</span></div>
        </div>
      )}

      {/* Legend */}
      <div className="m3-legend">
        <span className="m3-legend-item"><span className="m3-legend-swatch" style={{ background: "#00e0a4" }} />BULL</span>
        <span className="m3-legend-item"><span className="m3-legend-swatch" style={{ background: "#ff4f6e" }} />BEAR</span>
        <span className="m3-legend-item"><span className="m3-legend-swatch" style={{ background: "#115e59" }} />TAKER BUY</span>
        <span className="m3-legend-item"><span className="m3-legend-swatch" style={{ background: "#881337" }} />TAKER SELL</span>
        <span className="m3-legend-item"><span className="m3-legend-swatch" style={{ width: 12, background: "rgba(14,165,233,0.3)", border: "1px solid rgba(56,189,248,0.4)" }} />DEPTH WALL</span>
      </div>

      {isLoading && (
        <div className="m3-overlay-full m3-loading-overlay">
          <div className="m3-spinner" />
          <div className="m3-loading-text">CONNECTING TO LIVE 3D MARKET LINK</div>
        </div>
      )}

      {isFatal && (
        <div className="m3-overlay-full m3-fatal-overlay">
          <div style={{ fontSize: 24 }}>⚠️</div>
          <div style={{ fontWeight: 700, color: "#cbd5e1" }}>WebGL Unavailable</div>
          <div style={{ fontSize: 12, color: "#64748b", maxWidth: 384 }}>WebGL is required for 3D candlestick and depth rendering.</div>
        </div>
      )}
    </>
  );
}
