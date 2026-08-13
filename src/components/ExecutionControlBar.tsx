import React from "react";
import { Shield, Eye, Zap, Key, CheckCircle2, AlertTriangle, ChevronDown } from "lucide-react";

export type ExecutionMode = "paper" | "real";
export type ExecutionBroker = "binance" | "coindcx";
export type ExecutionSubMode = "monitor" | "live";

interface ExecutionControlBarProps {
  execMode: ExecutionMode;
  onSetExecMode: (mode: ExecutionMode) => void;
  selectedBroker: ExecutionBroker;
  onSetBroker: (broker: ExecutionBroker) => void;
  execSubMode: ExecutionSubMode;
  onSetSubMode: (subMode: ExecutionSubMode) => void;
  authStatus: { binance: boolean; coindcx: boolean };
  onOpenAuthModal: () => void;
}

export const ExecutionControlBar: React.FC<ExecutionControlBarProps> = ({
  execMode,
  onSetExecMode,
  selectedBroker,
  onSetBroker,
  execSubMode,
  onSetSubMode,
  authStatus,
  onOpenAuthModal,
}) => {
  const isCoinDcxAuthed = authStatus.coindcx;
  const currentAuthed = selectedBroker === "binance" ? authStatus.binance : isCoinDcxAuthed;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
      {/* 1. Primary Execution Mode Switcher (Paper vs Real Broker) */}
      <div
        style={{
          display: "flex",
          background: "rgba(0, 0, 0, 0.4)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: "6px",
          padding: "2px",
        }}
      >
        <button
          onClick={() => onSetExecMode("paper")}
          style={{
            background: execMode === "paper" ? "rgba(0, 245, 160, 0.2)" : "transparent",
            color: execMode === "paper" ? "#00F5A0" : "rgba(255, 255, 255, 0.6)",
            border: execMode === "paper" ? "1px solid rgba(0, 245, 160, 0.4)" : "1px solid transparent",
            borderRadius: "4px",
            padding: "3px 8px",
            fontSize: "11px",
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            transition: "all 0.15s ease",
          }}
        >
          <span>📝</span>
          <span>PAPER</span>
        </button>
        <button
          onClick={() => onSetExecMode("real")}
          style={{
            background: execMode === "real" ? "rgba(0, 229, 255, 0.2)" : "transparent",
            color: execMode === "real" ? "#00E5FF" : "rgba(255, 255, 255, 0.6)",
            border: execMode === "real" ? "1px solid rgba(0, 229, 255, 0.4)" : "1px solid transparent",
            borderRadius: "4px",
            padding: "3px 8px",
            fontSize: "11px",
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            transition: "all 0.15s ease",
          }}
        >
          <span>⚡</span>
          <span>REAL EXECUTION</span>
        </button>
      </div>

      {/* 2. Broker Selector & Sub-Mode (Active when Real Broker is selected) */}
      {execMode === "real" && (
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {/* Broker Dropdown / Toggle */}
          <div
            style={{
              display: "flex",
              background: "rgba(0, 0, 0, 0.4)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "6px",
              padding: "2px",
            }}
          >
            <button
              onClick={() => onSetBroker("binance")}
              style={{
                background: selectedBroker === "binance" ? "rgba(240, 185, 11, 0.2)" : "transparent",
                color: selectedBroker === "binance" ? "#F0B90B" : "rgba(255, 255, 255, 0.6)",
                border: selectedBroker === "binance" ? "1px solid rgba(240, 185, 11, 0.4)" : "1px solid transparent",
                borderRadius: "4px",
                padding: "3px 8px",
                fontSize: "10.5px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              BINANCE USD-M
            </button>
            <button
              onClick={() => onSetBroker("coindcx")}
              style={{
                background: selectedBroker === "coindcx" ? "rgba(33, 150, 243, 0.25)" : "transparent",
                color: selectedBroker === "coindcx" ? "#64B5F6" : "rgba(255, 255, 255, 0.6)",
                border: selectedBroker === "coindcx" ? "1px solid rgba(33, 150, 243, 0.4)" : "1px solid transparent",
                borderRadius: "4px",
                padding: "3px 8px",
                fontSize: "10.5px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              COINDCX FUTURES
            </button>
          </div>

          {/* Sub-Mode: Monitor Only vs Live Mode */}
          <div
            style={{
              display: "flex",
              background: "rgba(0, 0, 0, 0.4)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "6px",
              padding: "2px",
            }}
          >
            <button
              onClick={() => onSetSubMode("monitor")}
              title="Read-only account tracking: live positions & orders on chart without live order routing"
              style={{
                background: execSubMode === "monitor" ? "rgba(0, 229, 255, 0.15)" : "transparent",
                color: execSubMode === "monitor" ? "#00E5FF" : "rgba(255, 255, 255, 0.5)",
                border: "none",
                borderRadius: "4px",
                padding: "3px 7px",
                fontSize: "10.5px",
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "3px",
              }}
            >
              <Eye size={12} />
              <span>MONITOR</span>
            </button>
            <button
              onClick={() => onSetSubMode("live")}
              title="Full live trading mode: place, edit, and cancel real broker orders"
              style={{
                background: execSubMode === "live" ? "rgba(255, 73, 92, 0.2)" : "transparent",
                color: execSubMode === "live" ? "#FF495C" : "rgba(255, 255, 255, 0.5)",
                border: "none",
                borderRadius: "4px",
                padding: "3px 7px",
                fontSize: "10.5px",
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "3px",
              }}
            >
              <Zap size={12} />
              <span>LIVE</span>
            </button>
          </div>

          {/* Auth / Credentials Status Indicator */}
          <button
            onClick={onOpenAuthModal}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              background: currentAuthed ? "rgba(0, 245, 160, 0.1)" : "rgba(255, 167, 38, 0.15)",
              border: currentAuthed ? "1px solid rgba(0, 245, 160, 0.3)" : "1px solid rgba(255, 167, 38, 0.4)",
              color: currentAuthed ? "#00F5A0" : "#FFA726",
              borderRadius: "5px",
              padding: "3px 7px",
              fontSize: "10px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <Key size={11} />
            <span>{currentAuthed ? "AUTH OK" : "CONFIG KEYS"}</span>
          </button>
        </div>
      )}
    </div>
  );
};
