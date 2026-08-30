import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { Candle3D, MarketStats, Timeframe3D, Market3DProps, DepthData, TradeItem, BookTicker } from "./types";
import { fetchKlinesFromBinance, computeMarketStats, restBinanceGet } from "./dataService";
import { useThreeScene } from "./useThreeScene";
import { useMarketWebSocket } from "./useMarketWebSocket";
import { Market3DHeader } from "./Market3DHeader";
import { Market3DOverlay } from "./Market3DOverlay";
import { OrderBookPanel } from "./OrderBookPanel";
import { TimeAndSalesPanel } from "./TimeAndSalesPanel";
import "./market3d.css";

export function Market3DView({
  symbol = "SOLUSDT",
  defaultTimeframe = "1h",
  defaultCandleCount = 140,
  defaultAutoOrbit = false,
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

  const [isLoading, setIsLoading] = useState(true);
  const [isFatal, setIsFatal] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Scene visual toggles
  const [showVolume, setShowVolume] = useState(true);
  const [showDepth, setShowDepth] = useState(true);
  const [showFlow, setShowFlow] = useState(true);
  const [autoOrbit, setAutoOrbit] = useState(defaultAutoOrbit);
  const [enableBloom, setEnableBloom] = useState(true);
  const [showBook, setShowBook] = useState(true);
  const [showTape, setShowTape] = useState(true);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const {
    pointerRef,
    goalTargetRef,
    metricsRef,
    candleObjsRef,
    resetCamera,
    rebuildChart,
    updateLastCandle,
    updateDepthWall,
    spawnTradeParticle,
  } = useThreeScene({
    wrapRef,
    canvasRef,
    autoOrbit,
    enableBloom,
    showVolume,
    showDepth,
    showFlow,
    onHoverChange: setHoveredIndex,
    onFatalError: () => {
      setIsFatal(true);
      setIsLoading(false);
    },
  });

  const handleKlineStream = useCallback(
    (k: Candle3D) => {
      setData((prev) => {
        if (!prev.length) return [k];
        const last = prev[prev.length - 1];
        if (k.t === last.t) {
          const next = [...prev];
          next[next.length - 1] = k;
          updateLastCandle(k);
          return next;
        }
        if (k.t > last.t) {
          const next = [...prev, k];
          if (next.length > candleCount) next.shift();
          rebuildChart(next, timeframe, false, false);
          return next;
        }
        return prev;
      });
    },
    [candleCount, timeframe, updateLastCandle, rebuildChart]
  );

  const handleTradeStream = useCallback(
    (t: TradeItem) => {
      setTrades((prev) => [t, ...prev.slice(0, 49)]);
      spawnTradeParticle(t.price, !t.isSell, t.usd);
    },
    [spawnTradeParticle]
  );

  const handleDepthStream = useCallback(
    (d: DepthData) => {
      setDepth(d);
      updateDepthWall(d.bids, d.asks);
    },
    [updateDepthWall]
  );

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
    setIsLoading(true);
    try {
      const res = await fetchKlinesFromBinance(currentSymbol, timeframe, candleCount);
      setData(res.data);
      setStats(computeMarketStats(res.data));
      rebuildChart(res.data, timeframe, true, true);

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
    } finally {
      setIsLoading(false);
    }
  }, [currentSymbol, timeframe, candleCount, rebuildChart]);

  useEffect(() => {
    loadInitialSnapshot();
  }, [loadInitialSnapshot]);

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const r = canvasRef.current.getBoundingClientRect();
    pointerRef.current.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointerRef.current.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    pointerRef.current.active = true;
    setTooltipPos({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointerRef.current.isDown = false;
    const dist = Math.hypot(e.clientX - pointerRef.current.downPos[0], e.clientY - pointerRef.current.downPos[1]);
    const m = metricsRef.current;
    if (dist < 6 && hoveredIndex !== null && candleObjsRef.current[hoveredIndex] && m) {
      const o = candleObjsRef.current[hoveredIndex];
      goalTargetRef.current = new THREE.Vector3(m.xPos[hoveredIndex], o.mid, 0);
    }
  };

  const activeCandle =
    hoveredIndex !== null && data[hoveredIndex]
      ? data[hoveredIndex]
      : data.length > 0
        ? data[data.length - 1]
        : null;

  return (
    <div className="m3-root">
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

      <div ref={wrapRef} style={{ position: "relative", flex: 1, overflow: "hidden", background: "#05070d" }}>
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", cursor: "grab" }}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => { pointerRef.current.active = false; setHoveredIndex(null); }}
          onPointerDown={(e) => {
            pointerRef.current.isDown = true;
            pointerRef.current.downPos = [e.clientX, e.clientY];
          }}
          onPointerUp={handlePointerUp}
        />

        <OrderBookPanel depth={depth} livePrice={activeCandle?.c || null} isOpen={showBook} />
        <TimeAndSalesPanel trades={trades} isOpen={showTape} />

        <Market3DOverlay
          timeframe={timeframe}
          setTimeframe={setTimeframe}
          candleCount={candleCount}
          setCandleCount={setCandleCount}
          showVolume={showVolume}
          setShowVolume={setShowVolume}
          showDepth={showDepth}
          setShowDepth={setShowDepth}
          showFlow={showFlow}
          setShowFlow={setShowFlow}
          autoOrbit={autoOrbit}
          setAutoOrbit={setAutoOrbit}
          enableBloom={enableBloom}
          setEnableBloom={setEnableBloom}
          showBook={showBook}
          setShowBook={setShowBook}
          showTape={showTape}
          setShowTape={setShowTape}
          onResetCamera={resetCamera}
          activeCandle={activeCandle}
          hoveredIndex={hoveredIndex}
          tooltipPos={tooltipPos}
          isLoading={isLoading}
          isFatal={isFatal}
        />
      </div>
    </div>
  );
}

export default Market3DView;
