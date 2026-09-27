import { useEffect, useRef, useState, useCallback } from "react";
import { Candle3D, WsStatus, Timeframe3D } from "./types";
import { pingBinanceTime } from "./dataService";

const WS_HOSTS = ["wss://data-stream.binance.vision", "wss://stream.binance.com:9443"];

interface UseMarketWebSocketParams {
  symbol: string;
  timeframe: Timeframe3D;
  onKline: (kline: Candle3D) => void;
}

export function useMarketWebSocket({ symbol, timeframe, onKline }: UseMarketWebSocketParams) {
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [msgRate, setMsgRate] = useState(0);
  const [pingMs, setPingMs] = useState<number | null>(null);

  const callbacksRef = useRef({ onKline });
  useEffect(() => {
    callbacksRef.current = { onKline };
  });

  const wsRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const hostIndexRef = useRef(0);
  const msgCountRef = useRef(0);
  const simTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const openTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isDestroyedRef = useRef(false);

  const cleanSymbol = symbol.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const pair = cleanSymbol.endsWith("usdt") ? cleanSymbol : `${cleanSymbol}usdt`;

  const stopSim = () => {
    if (simTimerRef.current) {
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
  };

  const startSim = useCallback(() => {
    if (simTimerRef.current || isDestroyedRef.current) return;
    setWsStatus("sim");

    let price = 180;
    simTimerRef.current = setInterval(() => {
      if (isDestroyedRef.current) return;
      const volat = price * 0.0012;
      const drift = (Math.random() - 0.5) * volat * 2.2;
      price = Math.max(1, price + drift);

      callbacksRef.current.onKline({
        t: Date.now(),
        o: price - drift,
        h: Math.max(price, price - drift) * 1.002,
        l: Math.min(price, price - drift) * 0.998,
        c: price,
        v: 100 + Math.random() * 50,
        bv: 50 + Math.random() * 25,
      });
    }, 750);
  }, []);

  const routeMessage = (d: any) => {
    msgCountRef.current++;
    if (d.e === "kline" && d.k) {
      const k = d.k;
      callbacksRef.current.onKline({
        t: k.t,
        o: Number(k.o),
        h: Number(k.h),
        l: Number(k.l),
        c: Number(k.c),
        v: Number(k.v),
        bv: Number(k.V || 0),
      });
    }
  };

  const cleanupActiveSocket = () => {
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {}
    }
  };

  const connectWs = useCallback(() => {
    if (isDestroyedRef.current) return;
    cleanupActiveSocket();

    const host = WS_HOSTS[hostIndexRef.current % WS_HOSTS.length];
    const streams = [`${pair}@kline_${timeframe}`].join("/");

    if (attemptsRef.current === 0) setWsStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${host}/stream?streams=${streams}`);
    } catch {
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    openTimeoutRef.current = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        cleanupActiveSocket();
        scheduleReconnect();
      }
    }, 6000);

    ws.onopen = () => {
      if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);
      attemptsRef.current = 0;
      stopSim();
      setWsStatus("live");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.data) routeMessage(msg.data);
      } catch {}
    };

    ws.onerror = () => {
      cleanupActiveSocket();
      scheduleReconnect();
    };

    ws.onclose = () => {
      cleanupActiveSocket();
      scheduleReconnect();
    };
  }, [pair, timeframe]);

  const scheduleReconnect = () => {
    if (isDestroyedRef.current) return;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);

    attemptsRef.current++;
    hostIndexRef.current++;
    if (attemptsRef.current >= 2) startSim();

    const delay = Math.min(1000 * Math.pow(1.8, attemptsRef.current), 15000);
    reconnectTimerRef.current = setTimeout(() => {
      if (!isDestroyedRef.current) connectWs();
    }, delay);
  };

  useEffect(() => {
    isDestroyedRef.current = false;
    attemptsRef.current = 0;
    connectWs();

    return () => {
      isDestroyedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      cleanupActiveSocket();
      stopSim();
    };
  }, [connectWs]);

  useEffect(() => {
    const rateTimer = setInterval(() => {
      setMsgRate(msgCountRef.current);
      msgCountRef.current = 0;
    }, 1000);

    let isSubscribed = true;
    const pingLoop = async () => {
      const ms = await pingBinanceTime();
      if (isSubscribed) setPingMs(ms);
      if (isSubscribed) setTimeout(pingLoop, 12000);
    };
    pingLoop();

    return () => {
      isSubscribed = false;
      clearInterval(rateTimer);
    };
  }, []);

  return { wsStatus, msgRate, pingMs };
}
