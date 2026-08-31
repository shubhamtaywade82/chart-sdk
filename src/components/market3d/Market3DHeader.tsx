import React from "react";
import { Candle3D, MarketStats, BookTicker, WsStatus } from "./types";
import { formatPrice, formatVolume } from "./dataService";

interface Market3DHeaderProps {
  currentSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  activeCandle: Candle3D | null;
  stats: MarketStats;
  bookTicker: BookTicker | null;
  wsStatus: WsStatus;
  msgRate: number;
  pingMs: number | null;
}

const POPULAR_SYMBOLS = ["SOLUSDT", "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];

const STATUS_MAP: Record<WsStatus, { color: string; label: string }> = {
  live: { color: "#5eead4", label: "LIVE · WS" },
  connecting: { color: "#38bdf8", label: "CONNECTING" },
  reconnecting: { color: "#fbbf24", label: "RECONNECTING" },
  sim: { color: "#fbbf24", label: "SIMULATED" },
  offline: { color: "#fb7185", label: "OFFLINE" },
};

export function Market3DHeader({
  currentSymbol,
  onSelectSymbol,
  activeCandle,
  stats,
  bookTicker,
  wsStatus,
  msgRate,
  pingMs,
}: Market3DHeaderProps) {
  const isPositive = stats.chg >= 0;
  const status = STATUS_MAP[wsStatus] || STATUS_MAP.connecting;

  return (
    <header className="m3-header">
      <div className="m3-brand">
        <div className="m3-brand-name">DEPTH<span className="m3-brand-accent">CUBE</span></div>
        <div className="m3-brand-tag">LIVE MARKET ENGINE</div>
      </div>

      <div className="m3-divider-v" />

      <div className="m3-symbol-row">
        <select
          value={currentSymbol.toUpperCase()}
          onChange={(e) => onSelectSymbol(e.target.value)}
          className="m3-select"
        >
          {POPULAR_SYMBOLS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div className="m3-price">{activeCandle ? `$${formatPrice(activeCandle.c)}` : "—"}</div>
        <span className={`m3-change-badge ${isPositive ? "pos" : "neg"}`}>
          {isPositive ? "▲ +" : "▼ "}{stats.chg.toFixed(2)}%
        </span>
      </div>

      {bookTicker && (
        <div className="m3-bidask">
          <div>
            <span style={{ color: "#475569" }}>BID</span> <span style={{ color: "#5eead4" }}>{formatPrice(bookTicker.bid)}</span>{" "}
            <span style={{ color: "#475569", marginLeft: 6 }}>ASK</span> <span style={{ color: "#fda4af" }}>{formatPrice(bookTicker.ask)}</span>
          </div>
          <div style={{ color: "#64748b", marginTop: 2 }}>
            SPREAD <span style={{ color: "#cbd5e1" }}>{bookTicker.spread.toFixed(3)} ({bookTicker.spreadBps.toFixed(1)}bp)</span>
          </div>
        </div>
      )}

      <div className="m3-stats">
        <div><div className="m3-stat-label">24H HIGH</div><div style={{ color: "#99f6e4" }}>{stats.hi ? formatPrice(stats.hi) : "—"}</div></div>
        <div><div className="m3-stat-label">24H LOW</div><div style={{ color: "#fda4af" }}>{stats.lo ? formatPrice(stats.lo) : "—"}</div></div>
        <div><div className="m3-stat-label">24H VOL</div><div style={{ color: "#bae6fd" }}>{stats.vol ? formatVolume(stats.vol) : "—"}</div></div>
      </div>

      <div className="m3-status-wrap">
        <div className="m3-status-pill">
          <span className="m3-status-dot" style={{ background: status.color }} />
          <span style={{ color: "#94a3b8", letterSpacing: "0.1em" }}>{status.label}</span>
          <span style={{ color: "#334155" }}>|</span>
          <span style={{ color: "#94a3b8" }}>{msgRate} msg/s</span>
          <span style={{ color: "#334155" }}>|</span>
          <span style={{ color: "#94a3b8" }}>{pingMs != null ? `ping ${pingMs}ms` : "ping —"}</span>
        </div>
      </div>
    </header>
  );
}
