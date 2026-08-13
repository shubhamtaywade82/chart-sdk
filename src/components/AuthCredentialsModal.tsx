import React from "react";
import { X, ShieldCheck, Key, AlertCircle, CheckCircle2 } from "lucide-react";
import type { ExecutionBroker } from "./ExecutionControlBar";

interface AuthCredentialsModalProps {
  selectedBroker: ExecutionBroker;
  authStatus: { binance: boolean; coindcx: boolean };
  onClose: () => void;
}

export const AuthCredentialsModal: React.FC<AuthCredentialsModalProps> = ({
  selectedBroker,
  authStatus,
  onClose,
}) => {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "90vw",
          maxWidth: "520px",
          background: "#0E131F",
          border: "1px solid rgba(0, 229, 255, 0.3)",
          borderRadius: "12px",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.8)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            background: "#141A29",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Key size={16} color="#00E5FF" />
            <span style={{ fontSize: "14px", fontWeight: 700, color: "#FFFFFF" }}>
              BROKER API CREDENTIALS & STATUS
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Binance Status Card */}
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontWeight: 700, color: "#F0B90B", fontSize: "13px" }}>Binance USD-M Futures</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "#00F5A0", fontSize: "11px", fontWeight: 700 }}>
                <CheckCircle2 size={13} />
                <span>CONNECTED (Direct Feed)</span>
              </div>
            </div>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", marginTop: "6px" }}>
              High-speed public market data & USD-M Futures API connected.
            </div>
          </div>

          {/* CoinDCX Status Card */}
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontWeight: 700, color: "#64B5F6", fontSize: "13px" }}>CoinDCX Futures API</span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  color: authStatus.coindcx ? "#00F5A0" : "#FFA726",
                  fontSize: "11px",
                  fontWeight: 700,
                }}
              >
                {authStatus.coindcx ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                <span>{authStatus.coindcx ? "CONFIGURED" : "REQUIRES .ENV KEYS"}</span>
              </div>
            </div>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", marginTop: "6px" }}>
              Configure <code style={{ color: "#00E5FF" }}>COINDCX_API_KEY</code> and <code style={{ color: "#00E5FF" }}>COINDCX_API_SECRET</code> in your local <code style={{ color: "#00E5FF" }}>.env</code> file for authenticated live order routing.
            </div>
          </div>

          {/* Mode Descriptions */}
          <div style={{ padding: "12px", background: "rgba(0, 229, 255, 0.05)", borderRadius: "6px", border: "1px solid rgba(0, 229, 255, 0.15)" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#00E5FF", marginBottom: "4px" }}>
              EXECUTION MODES GUIDE:
            </div>
            <ul style={{ fontSize: "11px", color: "rgba(255,255,255,0.7)", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "4px" }}>
              <li><strong>📝 Paper Trading</strong>: Zero-risk simulated execution with $100,000 virtual USDT.</li>
              <li><strong>👁️ Monitor Only</strong>: Live tracking of real account balance, open positions & orders without order execution.</li>
              <li><strong>🚀 Live Trading</strong>: Full live order routing with real margin and automated trade lines.</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 18px",
            background: "#141A29",
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: "#00F5A0",
              color: "#051610",
              border: "none",
              padding: "6px 16px",
              borderRadius: "5px",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            GOT IT
          </button>
        </div>
      </div>
    </div>
  );
};
