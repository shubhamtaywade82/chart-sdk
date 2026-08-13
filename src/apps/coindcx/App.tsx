import { CoindcxAdapter } from "../../adapters/CoindcxAdapter";
const adapterInstance = new CoindcxAdapter();

import React, { useEffect, useState } from "react";
import {
  Activity,
  BarChart2,
  Clock,
  DollarSign,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Target,
  Wallet,
  Zap,
} from "lucide-react";
import { TradingViewChart, formatPriceDynamic, getPricePrecision } from "../../components/TradingViewChart";
import { MarketDepthStream } from "../../components/MarketDepthStream";
import { ConfluenceBacktestWorkbench } from "../../components/research/ConfluenceBacktestWorkbench";

interface TickData {
  symbol: string;
  securityId: string;
  ltp: number;
  change: number;
  pChange: number;
  volume: number;
  bids: Array<{ price: number; quantity: number; orders: number }>;
  asks: Array<{ price: number; quantity: number; orders: number }>;
  timestamp: string;
}

interface SessionInfo {
  isOpen: boolean;
  exchange: string;
  marketType: string;
  lastCompletedTradingDay: string;
}

export function App() {
  const VALID_TABS = ["terminal", "portfolio"] as const;
  const [activeTab, setActiveTab] = useState<"terminal" | "confluence_backtest" | "portfolio">(() => {
    const saved = localStorage.getItem("coindcx_activeTab");
    return (VALID_TABS.includes(saved as any) ? saved : "terminal") as any;
  });
  const [selectedSymbol, setSelectedSymbol] = useState(() => {
    return localStorage.getItem("coindcx_selectedSymbol") || "btcusdt";
  });
  const [selectedInterval, setSelectedInterval] = useState(() => {
    const saved = localStorage.getItem("coindcx_selectedInterval");
    const validKeys = adapterInstance.getIntervals().map((i) => i.key);
    return saved && validKeys.includes(saved) ? saved : "15";
  });

  const [showLeftSidebar, setShowLeftSidebar] = useState(() => {
    return localStorage.getItem("coindcx_showLeftSidebar") !== "false";
  });
  const [showDepthPanel, setShowDepthPanel] = useState(() => {
    return localStorage.getItem("coindcx_showDepthPanel") !== "false";
  });

  useEffect(() => {
    localStorage.setItem("coindcx_activeTab", activeTab);
  }, [activeTab]);
  useEffect(() => {
    localStorage.setItem("coindcx_selectedSymbol", selectedSymbol);
  }, [selectedSymbol]);
  useEffect(() => {
    localStorage.setItem("coindcx_selectedInterval", selectedInterval);
  }, [selectedInterval]);
  useEffect(() => {
    localStorage.setItem("coindcx_showLeftSidebar", String(showLeftSidebar));
  }, [showLeftSidebar]);
  useEffect(() => {
    localStorage.setItem("coindcx_showDepthPanel", String(showDepthPanel));
  }, [showDepthPanel]);

  // Real-time tick & depth state
  const [tick, setTick] = useState<TickData | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const wsRef = React.useRef<WebSocket | null>(null);

  // Account data (real positions / funds / orders)
  const [funds, setFunds] = useState<any>(null);
  const [positions, setPositions] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [portfolioSubTab, setPortfolioSubTab] = useState<"positions" | "orders">("positions");
  const [loading, setLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  // 1. Poll session info & connect WebSocket feed
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await fetch("/api/session-info");
        const json = await res.json();
        if (json.session) setSession(json.session);
      } catch (e) {}
    };

    fetchSession();
    const sessionTimer = setInterval(fetchSession, 30000);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/coindcx/feed`;
    let ws: WebSocket | null = null;
    let isCleanedUp = false;
    let retryCount = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      if (isCleanedUp) return;
      setWsConnected(false);
      const delay = Math.min(30000, 1000 * 2 ** retryCount);
      retryCount += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, delay);
    };

    const connect = () => {
      if (isCleanedUp) return;
      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.onopen = () => {
          if (!isCleanedUp) {
            retryCount = 0;
            setWsConnected(true);
            ws?.send(JSON.stringify({ type: "subscribe", symbol: selectedSymbol }));
          }
        };
        ws.onmessage = (event) => {
          if (isCleanedUp) return;
          try {
            const data = JSON.parse(event.data);
            if (data.type === "tick") {
              if (data.securityId && String(data.securityId).toLowerCase() !== selectedSymbol.toLowerCase()) return;
              setTick(data);
            }
          } catch (e) {}
        };
        ws.onclose = scheduleReconnect;
        ws.onerror = scheduleReconnect;
      } catch (e) {
        setWsConnected(false);
        scheduleReconnect();
      }
    };

    connect();

    return () => {
      isCleanedUp = true;
      clearInterval(sessionTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        } else {
          ws.onopen = () => ws?.close();
        }
      }
    };
  }, [selectedSymbol]);

  const fetchAccount = async () => {
    setLoading(true);
    setAccountError(null);
    try {
      const [fRes, pRes, oRes] = await Promise.all([
        fetch("/api/coindcx/funds"),
        fetch("/api/coindcx/positions"),
        fetch("/api/coindcx/orders"),
      ]);
      const [fJson, pJson, oJson] = await Promise.all([
        fRes.json(),
        pRes.json(),
        oRes.json(),
      ]);
      if (fJson.data) setFunds(fJson.data);
      if (pJson.error) setAccountError(pJson.error);
      if (Array.isArray(pJson.data)) setPositions(pJson.data);
      if (Array.isArray(oJson.data)) setOrders(oJson.data);
    } catch (e: any) {
      setAccountError(e?.message || "Failed to fetch account data");
    } finally {
      setLoading(false);
    }
  };

  // Fetch account data on mount, on tab switch, and poll while terminal is visible
  useEffect(() => {
    fetchAccount();
    const poll = setInterval(() => {
      if (activeTab === "terminal") fetchAccount();
    }, 5000);
    return () => clearInterval(poll);
  }, [activeTab]);

  const badge = { text: "LIVE 24/7 MARKET", class: "bg-green-glow" };

  // Header + portfolio metrics from the real CoinDCX futures wallet
  const accountMetrics = (() => {
    if (!funds) {
      return { equity: 0, balance: 0, realized: 0, unpnl: 0, unpnlPct: 0, openPos: null };
    }
    const avail = Number(funds.availMargin ?? 0);
    const used = Number(funds.usedMargin ?? 0);
    const unpnl = Number(funds.unrealizedPnl ?? 0);
    const equity = Number(funds.equity ?? avail + used + unpnl);
    return {
      balance: avail + used,
      equity,
      realized: 0,
      unpnl,
      unpnlPct: (avail + used) > 0 ? (unpnl / (avail + used)) * 100 : 0,
      openPos: positions.length > 0 ? positions : null,
    };
  })();

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-primary)" }}>
      {/* Header Bar */}
      <header
        className="glass-panel"
        style={{
          borderRadius: 0,
          padding: "0 14px",
          height: "46px",
          minHeight: "46px",
          maxHeight: "46px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--border-color)",
          whiteSpace: "nowrap",
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
          zIndex: 20,
          gap: "12px",
        }}
      >
        {/* Left: Brand & Symbol Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          <button
            onClick={() => setShowLeftSidebar(!showLeftSidebar)}
            className="glass-card"
            title="Toggle Navigation Sidebar"
            style={{ padding: "5px 7px", color: "var(--accent-cyan)", cursor: "pointer", display: "flex", alignItems: "center", borderRadius: "5px" }}
          >
            {showLeftSidebar ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: "24px", height: "24px", borderRadius: "6px", background: "linear-gradient(135deg, #00F5A0 0%, #00E5FF 100%)", display: "flex", alignItems: "center", justifyContent: "center", color: "#0A0D14" }}>
              <Zap size={14} strokeWidth={3} />
            </div>
            <div style={{ fontSize: "13px", fontWeight: 800, letterSpacing: "-0.3px", color: "#FFFFFF" }}>
              CoinDCX<span style={{ color: "#00F5A0" }}>Pro</span>
            </div>
          </div>

          {/* Symbol Pills */}
          <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", borderRadius: "6px", padding: "2px", gap: "2px" }}>
            {adapterInstance.getSymbols().map((sym) => (
              <button
                key={sym.key}
                onClick={() => setSelectedSymbol(sym.key)}
                style={{
                  background: selectedSymbol === sym.key ? "var(--bg-card)" : "transparent",
                  color: selectedSymbol === sym.key ? "var(--accent-cyan)" : "var(--text-secondary)",
                  border: selectedSymbol === sym.key ? "1px solid var(--border-hover)" : "1px solid transparent",
                  borderRadius: "4px",
                  padding: "3px 8px",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {sym.label.split("/")[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Account Summary & Status */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {/* Equity & PnL Capsule */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "3px 10px",
              borderRadius: "14px",
              background: "rgba(15, 19, 28, 0.85)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              fontFamily: "var(--font-mono)",
              fontSize: "10.5px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <Wallet size={12} color="var(--accent-cyan)" />
              <span style={{ color: "#FFFFFF", fontWeight: 800 }}>${formatPriceDynamic(accountMetrics.equity, 2)}</span>
            </div>
            {accountMetrics.openPos && (
              <>
                <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>|</span>
                <span style={{ fontWeight: 800, color: accountMetrics.unpnl >= 0 ? "#00F5A0" : "#FF495C" }}>
                  {accountMetrics.unpnl >= 0 ? "+" : ""}${formatPriceDynamic(accountMetrics.unpnl, 2)}
                </span>
                <span
                  style={{
                    fontWeight: 800,
                    color: accountMetrics.unpnl >= 0 ? "#00F5A0" : "#FF495C",
                    background: accountMetrics.unpnl >= 0 ? "rgba(0, 245, 160, 0.15)" : "rgba(255, 73, 92, 0.15)",
                    padding: "1px 5px",
                    borderRadius: "3px",
                  }}
                >
                  {accountMetrics.unpnl >= 0 ? "+" : ""}{accountMetrics.unpnlPct.toFixed(1)}%
                </span>
              </>
            )}
          </div>

          {/* Session Badge */}
          <div
            style={{
              padding: "3px 8px",
              borderRadius: "12px",
              fontSize: "10.5px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
            className={badge.class}
          >
            <Clock size={12} />
            <span>{session?.marketType === "CRYPTO_FUTURES_24X7" ? "24×7 CRYPTO" : badge.text}</span>
          </div>

          {/* Streaming Status Pill */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              fontSize: "10px",
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: "12px",
              background: wsConnected ? "rgba(0, 245, 160, 0.12)" : "rgba(255, 73, 92, 0.12)",
              color: wsConnected ? "#00F5A0" : "#FF495C",
              border: `1px solid ${wsConnected ? "rgba(0, 245, 160, 0.3)" : "rgba(255, 73, 92, 0.3)"}`,
            }}
          >
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: wsConnected ? "#00F5A0" : "#FF495C" }} />
            <span>{wsConnected ? "LIVE" : "OFFLINE"}</span>
          </div>

          {/* Depth Toggle */}
          <button
            onClick={() => setShowDepthPanel(!showDepthPanel)}
            className="glass-card"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 8px",
              borderRadius: "5px",
              color: showDepthPanel ? "var(--accent-green)" : "var(--text-secondary)",
              fontSize: "10.5px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {showDepthPanel ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            <span>DEPTH</span>
          </button>

          {/* Trader Controls (always locked — read-only account tracking) */}
          <button
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 8px",
              borderRadius: "5px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid var(--border-color)",
              color: "var(--text-secondary)",
              fontSize: "10.5px",
              fontWeight: 600,
            }}
          >
            <Lock size={12} />
            <span>READ-ONLY</span>
          </button>
        </div>
      </header>

      {/* Main Flex Layout */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left Sidebar */}
        {showLeftSidebar && (
          <aside
            className="glass-panel"
            style={{
              width: "200px",
              borderRadius: 0,
              borderRight: "1px solid var(--border-color)",
              borderTop: "none",
              borderBottom: "none",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              padding: "16px 10px",
              zIndex: 10,
            }}
          >
            <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 700, padding: "0 8px 8px 8px", letterSpacing: "0.5px" }}>
              TERMINAL VIEWS
            </div>
            {[
              { id: "terminal", label: "Real-Time Terminal", icon: BarChart2 },
              { id: "confluence_backtest", label: "SMC/ICT Confluence Backtest", icon: Activity },
              { id: "portfolio", label: `Positions & Account (${positions.length})`, icon: Target },
            ].map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id as any)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    background: isActive ? "rgba(0, 245, 160, 0.1)" : "transparent",
                    color: isActive ? "var(--accent-green)" : "var(--text-secondary)",
                    border: isActive ? "1px solid rgba(0, 245, 160, 0.3)" : "1px solid transparent",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.2s ease",
                  }}
                >
                  <Icon size={16} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </aside>
        )}

        {/* Center Main Dashboard */}
        <main style={{ flex: 1, padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px", overflowX: "hidden", minWidth: 0 }}>

          {/* TAB 1: TERMINAL & CHART — real positions drawn on the chart */}
          {activeTab === "terminal" && (
            <div style={{ display: "grid", gridTemplateColumns: showDepthPanel ? "minmax(0, 1fr) 380px" : "minmax(0, 1fr)", gap: "16px", flex: 1, minHeight: "520px", minWidth: 0, width: "100%" }}>
              <div className="glass-panel" style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "10px", minWidth: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
                    <BarChart2 size={16} color="var(--accent-cyan)" />
                    <span>{selectedSymbol.toUpperCase()} Futures — {positions.some((p) => String(p.symbol).toLowerCase() === selectedSymbol.toLowerCase()) ? "● LIVE POSITION" : "No Open Position"}</span>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {adapterInstance.getIntervals().map((item) => (
                      <button
                        key={item.key}
                        onClick={() => setSelectedInterval(item.key)}
                        style={{
                          padding: "4px 8px",
                          fontSize: "11px",
                          fontWeight: 600,
                          borderRadius: "4px",
                          background: selectedInterval === item.key ? "var(--accent-cyan)" : "rgba(255,255,255,0.05)",
                          color: selectedInterval === item.key ? "#0A0D14" : "var(--text-secondary)",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ flex: 1, minHeight: "520px" }}>
                  <TradingViewChart
                    adapter={adapterInstance}
                    symbol={selectedSymbol}
                    interval={selectedInterval}
                    livePrice={tick?.ltp}
                    tick={tick}
                    positions={positions}
                  />
                </div>
              </div>

              {showDepthPanel && (
                <MarketDepthStream bids={tick?.bids || []} asks={tick?.asks || []} symbol={selectedSymbol} />
              )}
            </div>
          )}

          {/* TAB 1B: SMC/ICT CONFLUENCE BACKTEST */}
          {activeTab === "confluence_backtest" && (
            <ConfluenceBacktestWorkbench symbol={selectedSymbol} adapter={adapterInstance} />
          )}

          {/* TAB 2: PORTFOLIO — real positions, orders & wallet */}
          {activeTab === "portfolio" && (
            <div className="glass-panel" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: "16px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
                  <DollarSign size={18} color="var(--accent-yellow)" />
                  <span>CoinDCX Futures Account — Positions & Orders</span>
                </div>
                <button
                  onClick={fetchAccount}
                  style={{
                    padding: "5px 12px",
                    borderRadius: "6px",
                    background: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid var(--border-color)",
                    color: "var(--accent-cyan)",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <RefreshCw size={12} /> Refresh Statement
                </button>
              </div>

              {accountError && (
                <div style={{ padding: "14px", borderRadius: "8px", background: "rgba(255,73,92,0.1)", border: "1px solid rgba(255,73,92,0.3)", color: "var(--accent-red)", fontSize: "12px" }}>
                  ⚠️ {accountError}
                </div>
              )}

              {/* Summary Metric Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
                <div className="glass-card" style={{ padding: "16px" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 700 }}>AVAILABLE MARGIN</span>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--accent-green)" }} className="mono">
                    ${formatPriceDynamic(accountMetrics.balance, 2)} <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>USDT</span>
                  </div>
                </div>
                <div className="glass-card" style={{ padding: "16px" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 700 }}>ACCOUNT EQUITY</span>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "#FFFFFF" }} className="mono">
                    ${formatPriceDynamic(accountMetrics.equity, 2)} <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>USDT</span>
                  </div>
                </div>
                <div className="glass-card" style={{ padding: "16px" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 700 }}>MARGIN USED</span>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--accent-cyan)" }} className="mono">
                    ${formatPriceDynamic(funds?.usedMargin ?? 0, 2)} <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>USDT</span>
                  </div>
                </div>
                <div className="glass-card" style={{ padding: "16px" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 700 }}>UNREALIZED P&L</span>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: accountMetrics.unpnl >= 0 ? "var(--accent-green)" : "var(--accent-red)" }} className="mono">
                    {accountMetrics.unpnl >= 0 ? "+" : ""}${formatPriceDynamic(accountMetrics.unpnl, 2)} <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>USDT</span>
                  </div>
                </div>
              </div>

              {/* Sub Navigation */}
              <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid var(--border-color)", paddingBottom: "10px" }}>
                {[
                  { id: "positions", label: `Active Positions (${positions.length})` },
                  { id: "orders", label: `Open Orders (${orders.length})` },
                ].map((st) => (
                  <button
                    key={st.id}
                    onClick={() => setPortfolioSubTab(st.id as any)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                      background: portfolioSubTab === st.id ? "rgba(0, 245, 160, 0.15)" : "transparent",
                      color: portfolioSubTab === st.id ? "#00F5A0" : "var(--text-secondary)",
                      border: portfolioSubTab === st.id ? "1px solid rgba(0, 245, 160, 0.4)" : "1px solid transparent",
                    }}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              {/* POSITIONS TABLE */}
              {portfolioSubTab === "positions" && (
                <div style={{ overflowX: "auto" }}>
                  {positions.length > 0 ? (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                      <thead>
                        <tr style={{ background: "rgba(0,0,0,0.3)", color: "var(--text-muted)", textAlign: "left", fontSize: "10px", fontWeight: 700 }}>
                          <th style={{ padding: "10px" }}>SYMBOL</th>
                          <th style={{ padding: "10px" }}>SIDE</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>QTY</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>LEVERAGE</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>ENTRY PRICE</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>MARK PRICE</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>STOP LOSS</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>TAKE PROFIT</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>LIQ PRICE</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>UNREALIZED PnL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {positions.map((p: any, idx: number) => {
                          const isLong = p.side === "LONG";
                          const spot = tick?.ltp || p.markPrice || p.entryPrice || 0;
                          const prec = getPricePrecision(Number(p.entryPrice) || 1).precision;
                          const pnlVal = Number(p.unrealizedPnl ?? ((spot - p.entryPrice) * p.qty * (isLong ? 1 : -1)));
                          const isProfit = pnlVal >= 0;
                          const matchesChart = String(p.symbol).toLowerCase() === selectedSymbol.toLowerCase();
                          return (
                            <tr
                              key={idx}
                              style={{
                                borderBottom: "1px solid var(--border-color)",
                                background: matchesChart ? "rgba(0, 229, 255, 0.06)" : "transparent",
                              }}
                            >
                              <td style={{ padding: "12px", fontWeight: 800, color: matchesChart ? "var(--accent-cyan)" : "var(--text-secondary)" }}>
                                {p.symbol?.toUpperCase()} {matchesChart && <span style={{ fontSize: "9px", color: "var(--accent-cyan)" }}>· ON CHART</span>}
                              </td>
                              <td style={{ padding: "12px" }}>
                                <span style={{ padding: "2px 6px", borderRadius: "4px", fontWeight: 700, background: isLong ? "rgba(0, 245, 160, 0.2)" : "rgba(255, 73, 92, 0.2)", color: isLong ? "#00F5A0" : "#FF495C" }}>
                                  {p.side}
                                </span>
                              </td>
                              <td style={{ padding: "12px", textAlign: "right" }} className="mono">{p.qty}</td>
                              <td style={{ padding: "12px", textAlign: "right" }} className="mono">{p.leverage || 1}x</td>
                              <td style={{ padding: "12px", textAlign: "right" }} className="mono">${formatPriceDynamic(p.entryPrice, prec)}</td>
                              <td style={{ padding: "12px", textAlign: "right" }} className="mono">${formatPriceDynamic(spot, prec)}</td>
                              <td style={{ padding: "12px", textAlign: "right", color: p.stopLoss ? "#FF495C" : "var(--text-muted)" }} className="mono">
                                {p.stopLoss ? `$${formatPriceDynamic(p.stopLoss, prec)}` : "-"}
                              </td>
                              <td style={{ padding: "12px", textAlign: "right", color: p.takeProfit ? "#00E5FF" : "var(--text-muted)" }} className="mono">
                                {p.takeProfit ? `$${formatPriceDynamic(p.takeProfit, prec)}` : "-"}
                              </td>
                              <td style={{ padding: "12px", textAlign: "right", color: "var(--text-muted)" }} className="mono">
                                {p.liquidationPrice ? `$${formatPriceDynamic(p.liquidationPrice, prec)}` : "-"}
                              </td>
                              <td style={{ padding: "12px", textAlign: "right", fontWeight: 800, color: isProfit ? "#00F5A0" : "#FF495C" }} className="mono">
                                {isProfit ? "+" : ""}${formatPriceDynamic(pnlVal, 2)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
                      {loading ? "Fetching positions..." : "No active open positions."}
                    </div>
                  )}
                </div>
              )}

              {/* ORDERS TABLE */}
              {portfolioSubTab === "orders" && (
                <div style={{ overflowX: "auto" }}>
                  {orders.length > 0 ? (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                      <thead>
                        <tr style={{ background: "rgba(0,0,0,0.3)", color: "var(--text-muted)", textAlign: "left", fontSize: "10px", fontWeight: 700 }}>
                          <th style={{ padding: "10px" }}>TIME</th>
                          <th style={{ padding: "10px" }}>SYMBOL</th>
                          <th style={{ padding: "10px" }}>TYPE</th>
                          <th style={{ padding: "10px" }}>SIDE</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>PRICE</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>QTY</th>
                          <th style={{ padding: "10px", textAlign: "right" }}>STATUS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((o: any, idx: number) => (
                          <tr key={idx} style={{ borderBottom: "1px solid var(--border-color)" }}>
                            <td style={{ padding: "12px" }} className="mono">{o.createdAt ? new Date(o.createdAt).toLocaleString() : "-"}</td>
                            <td style={{ padding: "12px", fontWeight: 800 }}>{o.symbol?.toUpperCase() || o.pair}</td>
                            <td style={{ padding: "12px" }}>{o.type}</td>
                            <td style={{ padding: "12px", color: o.side === "BUY" ? "#00F5A0" : "#FF495C", fontWeight: 700 }}>{o.side}</td>
                            <td style={{ padding: "12px", textAlign: "right" }} className="mono">${o.price}</td>
                            <td style={{ padding: "12px", textAlign: "right" }} className="mono">{o.qty}</td>
                            <td style={{ padding: "12px", textAlign: "right" }} className="mono">{o.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
                      {loading ? "Fetching orders..." : "No open or pending orders."}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
export default App;
