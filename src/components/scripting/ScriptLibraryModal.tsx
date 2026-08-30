import React, { useState } from "react";
import { BookOpen, Play, Edit3, Trash2, Download, Plus, X, LineChart, Target } from "lucide-react";
import type { UserScript } from "../../scripting/types";
import { getSavedScripts, deleteUserScript, exportScriptFile } from "../../scripting/scriptStorage";

interface ScriptLibraryModalProps {
  onClose: () => void;
  onSelectScript: (script: UserScript, runImmediately: boolean) => void;
  onNewScript: () => void;
}

export const ScriptLibraryModal: React.FC<ScriptLibraryModalProps> = ({
  onClose,
  onSelectScript,
  onNewScript,
}) => {
  const [scripts, setScripts] = useState<UserScript[]>(() => getSavedScripts());
  const [activeFilter, setActiveFilter] = useState<"all" | "indicator" | "strategy">("all");

  const handleDelete = (id: string) => {
    deleteUserScript(id);
    setScripts(getSavedScripts());
  };

  const filteredScripts = scripts.filter((s) => {
    if (activeFilter === "all") return true;
    return s.type === activeFilter;
  });

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
          maxWidth: "850px",
          maxHeight: "80vh",
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
            padding: "14px 20px",
            background: "#141A29",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <BookOpen size={18} color="#00E5FF" />
            <span style={{ fontSize: "15px", fontWeight: 700, color: "#FFFFFF" }}>SCRIPT LIBRARY & TEMPLATES</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              onClick={onNewScript}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                background: "#00F5A0",
                color: "#051610",
                border: "none",
                padding: "5px 12px",
                borderRadius: "5px",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <Plus size={13} />
              NEW SCRIPT
            </button>
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                color: "rgba(255,255,255,0.6)",
                border: "none",
                padding: "4px",
                cursor: "pointer",
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            padding: "10px 20px",
            background: "#0A0D15",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          }}
        >
          {(["all", "indicator", "strategy"] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              style={{
                background: activeFilter === filter ? "rgba(0, 229, 255, 0.18)" : "transparent",
                color: activeFilter === filter ? "#00E5FF" : "rgba(255, 255, 255, 0.6)",
                border: activeFilter === filter ? "1px solid rgba(0, 229, 255, 0.4)" : "1px solid transparent",
                padding: "4px 10px",
                borderRadius: "4px",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              {filter === "all" ? "All Scripts" : filter === "indicator" ? "Indicators" : "Strategies"}
            </button>
          ))}
        </div>

        {/* Script Cards List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {filteredScripts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "rgba(255,255,255,0.4)", fontSize: "13px" }}>
              No scripts found. Click "NEW SCRIPT" to write one!
            </div>
          ) : (
            filteredScripts.map((script) => {
              const isStrategy = script.type === "strategy";
              return (
                <div
                  key={script.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    background: "rgba(255, 255, 255, 0.03)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: "8px",
                    transition: "all 0.2s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "6px",
                        background: isStrategy ? "rgba(255, 73, 92, 0.15)" : "rgba(0, 229, 255, 0.15)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: isStrategy ? "#FF495C" : "#00E5FF",
                      }}
                    >
                      {isStrategy ? <Target size={16} /> : <LineChart size={16} />}
                    </div>

                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "13px", fontWeight: 700, color: "#FFFFFF" }}>{script.name}</span>
                        {script.isBuiltIn && (
                          <span
                            style={{
                              fontSize: "9px",
                              fontWeight: 700,
                              background: "rgba(0, 245, 160, 0.15)",
                              color: "#00F5A0",
                              padding: "1px 5px",
                              borderRadius: "3px",
                            }}
                          >
                            BUILT-IN
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: "9px",
                            fontWeight: 700,
                            background: isStrategy ? "rgba(255, 73, 92, 0.15)" : "rgba(0, 229, 255, 0.15)",
                            color: isStrategy ? "#FF495C" : "#00E5FF",
                            padding: "1px 5px",
                            borderRadius: "3px",
                          }}
                        >
                          {script.type.toUpperCase()}
                        </span>
                        <span
                          style={{
                            fontSize: "9px",
                            fontWeight: 600,
                            background: "rgba(255, 255, 255, 0.08)",
                            color: "rgba(255, 255, 255, 0.6)",
                            padding: "1px 5px",
                            borderRadius: "3px",
                          }}
                        >
                          {script.overlay ? "OVERLAY" : "SUB-PANE"}
                        </span>
                      </div>
                      <div style={{ fontSize: "11px", color: "rgba(255, 255, 255, 0.4)", marginTop: "2px" }}>
                        {script.code.split("\n")[0]} | {script.language.toUpperCase()}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <button
                      onClick={() => onSelectScript(script, true)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                        background: "#00F5A0",
                        color: "#051610",
                        border: "none",
                        padding: "5px 12px",
                        borderRadius: "4px",
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      <Play size={11} fill="#051610" />
                      APPLY
                    </button>
                    <button
                      onClick={() => onSelectScript(script, false)}
                      title="Edit in Script Editor"
                      style={{
                        background: "rgba(255, 255, 255, 0.08)",
                        color: "#FFFFFF",
                        border: "1px solid rgba(255, 255, 255, 0.15)",
                        padding: "5px 8px",
                        borderRadius: "4px",
                        fontSize: "11px",
                        cursor: "pointer",
                      }}
                    >
                      <Edit3 size={13} />
                    </button>
                    <button
                      onClick={() => exportScriptFile(script)}
                      title="Export .pine file"
                      style={{
                        background: "rgba(255, 255, 255, 0.08)",
                        color: "rgba(255,255,255,0.7)",
                        border: "1px solid rgba(255, 255, 255, 0.15)",
                        padding: "5px 8px",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      <Download size={13} />
                    </button>
                    {!script.isBuiltIn && (
                      <button
                        onClick={() => handleDelete(script.id)}
                        title="Delete custom script"
                        style={{
                          background: "rgba(255, 73, 92, 0.15)",
                          color: "#FF495C",
                          border: "1px solid rgba(255, 73, 92, 0.3)",
                          padding: "5px 8px",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
