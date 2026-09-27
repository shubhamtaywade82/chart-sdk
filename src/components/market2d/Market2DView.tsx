import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarketStats, Timeframe3D, Market3DProps } from "../market3d/types";
import { computeMarketStats, restBinanceGet } from "../market3d/dataService";
import { useMarketEngine } from "../../hooks/useMarketEngine";
import { Market3DHeader } from "../market3d/Market3DHeader";
import { TimeAndSalesPanel } from "../market3d/TimeAndSalesPanel";
import "../market3d/market3d.css";
import { CandleCanvas } from "./CandleCanvas";
import { OrderBookLadder } from "./OrderBookLadder";
import { DepthSnapshot, pushDepthSnapshot } from "./canvasRenderer";
import "./market2d.css";

type TickerOverride = Pick<MarketStats, "chg" | "hi" | "lo" | "vol">;

export function Market2DView({
  symbol = "SOLUSDT",
  defaultTimeframe = "1h",
  defaultCandleCount = 140,
  onSymbolChange,
}: Market3DProps) {
  const [currentSymbol, setCurrentSymbol] = useState(symbol);
  const [timeframe, setTimeframe] = useState<Timeframe3D>(defaultTimeframe);
  const [candleCount, setCandleCount] = useState(defaultCandleCount);
  const [tickerOverride, setTickerOverride] = useState<TickerOverride | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showVolume, setShowVolume] = useState(true);

  const depthHistoryRef = useRef<DepthSnapshot[]>([]);

  // Single WS connection: the server relay streams candles for the selected symbol+interval
  // alongside book/trades/funding, so the chart no longer needs its own direct-to-Binance socket.
  const engine = useMarketEngine(currentSymbol, timeframe);

  const data = useMemo(() => engine.candles.slice(-candleCount), [engine.candles, candleCount]);

  useEffect(() => {
    pushDepthSnapshot(depthHistoryRef.current, engine.book.bids, engine.book.asks);
  }, [engine.book]);

  const handleSelectSymbol = (sym: string) => {
    setCurrentSymbol(sym);
    if (onSymbolChange) onSymbolChange(sym);
  };

  const loadTickerStats = useCallback(async () => {
    depthHistoryRef.current = [];
    setTickerOverride(null);
    const clean = currentSymbol.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const pair = clean.endsWith("USDT") ? clean : `${clean}USDT`;
    try {
      const tk = await restBinanceGet<any>(`/api/v3/ticker/24hr?symbol=${pair}`);
      setTickerOverride({ chg: Number(tk.P), hi: Number(tk.h), lo: Number(tk.l), vol: Number(tk.v) });
    } catch {
      // keep candle-derived stats
    }
  }, [currentSymbol]);

  useEffect(() => {
    loadTickerStats();
  }, [loadTickerStats]);

  const baseStats = useMemo(() => computeMarketStats(data), [data]);
  const stats: MarketStats = tickerOverride ? { ...baseStats, ...tickerOverride } : baseStats;

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
