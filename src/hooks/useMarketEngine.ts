import { useEffect, useReducer, useRef, useState } from "react";
import type { EngineMessage } from "../../server/binance/engine/types";
import { applyEngineMessage, initialEngineState, type EngineState } from "./marketEngineState";

export type WsEngineStatus = "connecting" | "live" | "reconnecting" | "offline";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const PING_INTERVAL_MS = 12000;
const RATE_WINDOW_MS = 1000;

export function useMarketEngine(symbol: string, interval: string = "1m") {
  const [state, dispatch] = useReducer(
    (s: EngineState, action: EngineMessage | { type: "__reset" }) =>
      action.type === "__reset" ? initialEngineState : applyEngineMessage(s, action as EngineMessage),
    initialEngineState
  );
  const [wsStatus, setWsStatus] = useState<WsEngineStatus>("connecting");
  const [msgRate, setMsgRate] = useState(0);
  const [pingMs, setPingMs] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgCountRef = useRef(0);
  const isDestroyedRef = useRef(false);

  useEffect(() => {
    isDestroyedRef.current = false;
    reconnectAttemptsRef.current = 0;
    dispatch({ type: "__reset" });
    setWsStatus("connecting");

    const cleanupSocket = (ws: WebSocket | null) => {
      if (!ws) return;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      } catch {}
    };

    const scheduleReconnect = () => {
      if (isDestroyedRef.current) return;
      setWsStatus("reconnecting");
      reconnectAttemptsRef.current++;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttemptsRef.current, RECONNECT_MAX_MS);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    function connect() {
      if (isDestroyedRef.current) return;
      cleanupSocket(wsRef.current);
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/feed`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setWsStatus("live");
        try {
          ws.send(JSON.stringify({ type: "subscribe", symbol, interval }));
        } catch {}
      };
      ws.onmessage = (e) => {
        msgCountRef.current++;
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "tick") return; // legacy compat message, not consumed here
          dispatch(msg as EngineMessage);
        } catch {}
      };
      ws.onerror = () => scheduleReconnect();
      ws.onclose = () => scheduleReconnect();
    }

    connect();

    return () => {
      isDestroyedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      cleanupSocket(wsRef.current);
      wsRef.current = null;
    };
  }, [symbol, interval]);

  useEffect(() => {
    const rateTimer = setInterval(() => {
      setMsgRate(msgCountRef.current);
      msgCountRef.current = 0;
    }, RATE_WINDOW_MS);

    let isSubscribed = true;
    const pingLoop = async () => {
      const t0 = performance.now();
      try {
        await fetch("/api/session-info");
        if (isSubscribed) setPingMs(Math.round(performance.now() - t0));
      } catch {
        if (isSubscribed) setPingMs(null);
      }
      if (isSubscribed) setTimeout(pingLoop, PING_INTERVAL_MS);
    };
    pingLoop();

    return () => {
      isSubscribed = false;
      clearInterval(rateTimer);
    };
  }, []);

  return { ...state, wsStatus, msgRate, pingMs };
}
