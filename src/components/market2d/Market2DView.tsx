import React, { useCallback, useEffect, useRef, useState } from "react";
import { Candle3D, MarketStats, Timeframe3D, Market3DProps, DepthData, TradeItem, BookTicker } from "../market3d/types";
import { fetchKlinesFromBinance, computeMarketStats, restBinanceGet } from "../market3d/dataService";
import { useMarketWebSocket } from "../market3d/useMarketWebSocket";
import { Market3DHeader } from "../market3d/Market3DHeader";
import { TimeAndSalesPanel } from "../market3d/TimeAndSalesPanel";
import "../market3d/market3d.css";
import { CandleCanvas } from "./CandleCanvas";
import { OrderBookLadder } from "./OrderBookLadder";
import { DepthSnapshot, pushDepthSnapshot } from "./canvasRenderer";
import "./market2d.css";

export function Market2DView({
  symbol = "SOLUSDT",
  defaultTimeframe = "1h",
  defaultCandleCount = 140,
  onSymbolChange,
}: Market3DProps) {
  const [currentSymbol, setCurrentSymbol] = useState(symbol);
  const [timeframe, setTimeframe] = useState<Timeframe3D>(defaultTimeframe);
  const [candleCount, setCandleCount] = useState(defaultCandleCount);
  const [data, setData] = useState<Candle3D[]>([]);
  const [stats, setStats] = useState<MarketStats>({ hi: 0, lo: 0, vol: 0, chg: 0, win: "24H" });
  const [depth, setDepth] = useState<DepthData | null>(null);
  const [trades, setTrades] = useState<TradeItem[]>([]);
  const [bookTicker, setBookTicker] = useState<BookTicker | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showVolume, setShowVolume] = useState(true);

  const depthHistoryRef = useRef<DepthSnapshot[]>([]);

  const handleKlineStream = useCallback(
    (k: Candle3D) => {
      setData((prev) => {
        if (!prev.length) return [k];
        const last = prev[prev.length - 1];
        if (k.t === last.t) {
          const next = [...prev];
          next[next.length - 1] = k;
          return next;
        }
        if (k.t > last.t) {
          const next = [...prev, k];
          if (next.length > candleCount) next.shift();
          return next;
        }
        return prev;
      });
    },
    [candleCount]
  );

  const handleTradeStream = useCallback((t: TradeItem) => {
    setTrades((prev) => [t, ...prev.slice(0, 49)]);
  }, []);

  const handleDepthStream = useCallback((d: DepthData) => {
    setDepth(d);
    pushDepthSnapshot(depthHistoryRef.current, d.bids, d.asks);
  }, []);

  const handleTicker24hStream = useCallback((partial: Partial<MarketStats>) => {
    setStats((prev) => ({ ...prev, ...partial }));
  }, []);

  const { wsStatus, msgRate, pingMs } = useMarketWebSocket({
    symbol: currentSymbol,
    timeframe,
    onKline: handleKlineStream,
    onTrade: handleTradeStream,
    onDepth: handleDepthStream,
    onBookTicker: setBookTicker,
    onTicker24h: handleTicker24hStream,
  });

  const handleSelectSymbol = (sym: string) => {
    setCurrentSymbol(sym);
    if (onSymbolChange) onSymbolChange(sym);
  };

  const loadInitialSnapshot = useCallback(async () => {
    depthHistoryRef.current = [];
    try {
      const res = await fetchKlinesFromBinance(currentSymbol, timeframe, candleCount);
      setData(res.data);
      setStats(computeMarketStats(res.data));

      const clean = currentSymbol.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      const pair = clean.endsWith("USDT") ? clean : `${clean}USDT`;
      try {
        const tk = await restBinanceGet<any>(`/api/v3/ticker/24hr?symbol=${pair}`);
        setStats((prev) => ({ ...prev, chg: Number(tk.P), hi: Number(tk.h), lo: Number(tk.l), vol: Number(tk.v) }));
      } catch {}
      try {
        const bt = await restBinanceGet<any>(`/api/v3/ticker/bookTicker?symbol=${pair}`);
        const b = Number(bt.bidPrice); const a = Number(bt.askPrice);
        const spr = a - b;
        setBookTicker({ bid: b, ask: a, spread: spr, spreadBps: ((a + b) > 0 ? (spr / ((a + b) / 2)) * 1e4 : 0) });
      } catch {}
    } catch {
      // Fallback handled inside fetchKlinesFromBinance
    }
  }, [currentSymbol, timeframe, candleCount]);

  useEffect(() => {
    loadInitialSnapshot();
  }, [loadInitialSnapshot]);

  const activeCandle = data.length > 0 ? data[data.length - 1] : null;
  const timeframes: Timeframe3D[] = ["15m", "1h", "4h", "1d"];

  return (
    <div className="m2-root">
      <Market3DHeader
        currentSymbol={currentSymbol}
        onSelectSymbol={handleSelectSymbol}
        activeCandle={activeCandle}
        stats={stats}
        bookTicker={bookTicker}
        wsStatus={wsStatus}
        msgRate={msgRate}
        pingMs={pingMs}
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
          <OrderBookLadder depth={depth} livePrice={activeCandle?.c || null} />
          <div className="m2-tape-dock">
            <TimeAndSalesPanel trades={trades} isOpen={true} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Market2DView;
