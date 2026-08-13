import React, { useState } from "react";
import Editor from "@monaco-editor/react";
import { Play, Save, Download, Upload, X, Code2, BookOpen, AlertCircle, CheckCircle2 } from "lucide-react";
import type { ScriptLanguage, ScriptType, UserScript } from "../../scripting/types";
import { saveUserScript, exportScriptFile } from "../../scripting/scriptStorage";

interface ScriptEditorModalProps {
  initialScript?: UserScript | null;
  onClose: () => void;
  onRunScript: (code: string, language: ScriptLanguage, name: string) => { success: boolean; error?: string };
}

const DEFAULT_PINE_SCRIPT_V6 = `//@version=6
indicator("Custom EMA Signal v6", overlay=true)

fastLen = input.int(9, "Fast Length")
slowLen = input.int(21, "Slow Length")

fastEma = ta.ema(close, fastLen)
slowEma = ta.ema(close, slowLen)

plot(fastEma, color=color.aqua, title="Fast EMA", linewidth=2)
plot(slowEma, color=color.orange, title="Slow EMA", linewidth=2)

bull = ta.crossover(fastEma, slowEma) and close > slowEma
bear = ta.crossunder(fastEma, slowEma) and close < slowEma

plotshape(bull, style=shape.triangleup, location=location.belowbar, color=color.green, text="BUY")
plotshape(bear, style=shape.triangledown, location=location.abovebar, color=color.red, text="SELL")
`;

export const ScriptEditorModal: React.FC<ScriptEditorModalProps> = ({
  initialScript,
  onClose,
  onRunScript,
}) => {
  const [scriptName, setScriptName] = useState<string>(initialScript?.name || "My Custom Indicator v6");
  const [language, setLanguage] = useState<ScriptLanguage>(initialScript?.language || "pine");
  const [code, setCode] = useState<string>(initialScript?.code || DEFAULT_PINE_SCRIPT_V6);
  const [status, setStatus] = useState<{ type: "success" | "error" | "ready"; msg: string }>({
    type: "ready",
    msg: "Ready to execute (Pine Script v6)",
  });

  const handleRun = () => {
    setStatus({ type: "ready", msg: "Compiling and executing Pine v6 script..." });
    const result = onRunScript(code, language, scriptName);
    if (result.success) {
      setStatus({ type: "success", msg: "Pine v6 script compiled and applied successfully!" });
    } else {
      setStatus({ type: "error", msg: result.error || "Compilation failed" });
    }
  };

  const handleSave = () => {
    const isStrategy = code.includes("strategy(");
    const isOverlay = !code.includes("overlay=false");
    const script: UserScript = {
      id: initialScript?.id || `user_script_${Date.now()}`,
      name: scriptName,
      type: isStrategy ? ("strategy" as ScriptType) : ("indicator" as ScriptType),
      language,
      code,
      overlay: isOverlay,
      updatedAt: Date.now(),
    };
    saveUserScript(script);
    setStatus({ type: "success", msg: `Script "${scriptName}" saved to Library.` });
  };

  const handleExport = () => {
    exportScriptFile({
      id: "export",
      name: scriptName,
      type: code.includes("strategy(") ? "strategy" : "indicator",
      language,
      code,
      overlay: !code.includes("overlay=false"),
      updatedAt: Date.now(),
    });
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setCode(content);
        setScriptName(file.name.replace(/\.[^/.]+$/, ""));
        setStatus({ type: "success", msg: `Imported ${file.name}` });
      }
    };
    reader.readAsText(file);
  };

  const insertSnippet = (snippet: string) => {
    setCode((prev) => prev + "\n" + snippet);
  };

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
          maxWidth: "1100px",
          height: "85vh",
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
            padding: "12px 18px",
            background: "#141A29",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "6px",
                background: "rgba(0, 229, 255, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#00E5FF",
              }}
            >
              <Code2 size={16} />
            </div>
            <input
              type="text"
              value={scriptName}
              onChange={(e) => setScriptName(e.target.value)}
              placeholder="Script Title..."
              style={{
                background: "rgba(0, 0, 0, 0.3)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: "4px",
                padding: "4px 8px",
                color: "#FFFFFF",
                fontSize: "13px",
                fontWeight: 600,
                outline: "none",
                minWidth: "220px",
              }}
            />
            <div style={{ display: "flex", background: "rgba(0, 0, 0, 0.4)", borderRadius: "4px", padding: "2px" }}>
              <button
                onClick={() => setLanguage("pine")}
                style={{
                  background: language === "pine" ? "rgba(0, 229, 255, 0.2)" : "transparent",
                  color: language === "pine" ? "#00E5FF" : "rgba(255,255,255,0.6)",
                  border: "none",
                  padding: "3px 8px",
                  fontSize: "11px",
                  fontWeight: 700,
                  borderRadius: "3px",
                  cursor: "pointer",
                }}
              >
                PINE SCRIPT v6
              </button>
              <button
                onClick={() => setLanguage("javascript")}
                style={{
                  background: language === "javascript" ? "rgba(0, 229, 255, 0.2)" : "transparent",
                  color: language === "javascript" ? "#00E5FF" : "rgba(255,255,255,0.6)",
                  border: "none",
                  padding: "3px 8px",
                  fontSize: "11px",
                  fontWeight: 700,
                  borderRadius: "3px",
                  cursor: "pointer",
                }}
              >
                JAVASCRIPT
              </button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={handleRun}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "#00F5A0",
                color: "#051610",
                border: "none",
                padding: "6px 14px",
                borderRadius: "5px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <Play size={13} fill="#051610" />
              RUN ON CHART
            </button>
            <button
              onClick={handleSave}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                background: "rgba(255, 255, 255, 0.08)",
                color: "#FFFFFF",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                padding: "6px 12px",
                borderRadius: "5px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Save size={13} />
              SAVE
            </button>
            <button
              onClick={handleExport}
              title="Export script"
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                color: "rgba(255,255,255,0.8)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                padding: "6px",
                borderRadius: "5px",
                cursor: "pointer",
              }}
            >
              <Download size={14} />
            </button>
            <label
              title="Import script"
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                color: "rgba(255,255,255,0.8)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                padding: "6px",
                borderRadius: "5px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
              }}
            >
              <Upload size={14} />
              <input type="file" accept=".pine,.js,.txt" onChange={handleImport} style={{ display: "none" }} />
            </label>
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                color: "rgba(255,255,255,0.6)",
                border: "none",
                padding: "6px",
                cursor: "pointer",
                marginLeft: "8px",
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Main Editor */}
          <div style={{ flex: 1, height: "100%", background: "#0B0E17" }}>
            <Editor
              height="100%"
              theme="vs-dark"
              language={language === "pine" ? "javascript" : "javascript"}
              value={code}
              onChange={(v) => setCode(v || "")}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily: "monospace",
                lineNumbers: "on",
                automaticLayout: true,
                tabSize: 2,
                scrollBeyondLastLine: false,
              }}
            />
          </div>

          {/* Sidebar Reference */}
          <div
            style={{
              width: "260px",
              background: "#101624",
              borderLeft: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              flexDirection: "column",
              overflowY: "auto",
              padding: "12px",
              fontSize: "11px",
            }}
          >
            <div style={{ fontWeight: 700, color: "#00E5FF", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
              <BookOpen size={13} />
              PINE SCRIPT v6 CHEATSHEET
            </div>

            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "10px", marginBottom: "12px" }}>
              Click snippet to insert into script:
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {[
                { name: "v6 Input Int", code: 'len = input.int(14, "Length", minval=1)' },
                { name: "v6 Input Float", code: 'mult = input.float(2.0, "Multiplier", step=0.1)' },
                { name: "v6 Logical Condition", code: "cond = (close > ta.ema(close, 20)) and (rsi < 60)" },
                { name: "Plot Line", code: 'plot(series, color=color.aqua, title="My Line")' },
                { name: "Plot Signal Shape", code: 'plotshape(condition, style=shape.triangleup, location=location.belowbar, color=color.green, text="BUY")' },
                { name: "Average True Range", code: "atrVal = ta.atr(14)" },
                { name: "Stochastic Oscillator", code: "[k, d] = ta.stoch(14, 3, 3)" },
                { name: "Exponential MA", code: "fast = ta.ema(close, 14)" },
                { name: "RSI Oscillator", code: "rsiVal = ta.rsi(close, 14)" },
                { name: "MACD [macd, sig, hist]", code: "[m, s, h] = ta.macd(close, 12, 26, 9)" },
                { name: "Crossover Detection", code: "isBull = ta.crossover(fastEma, slowEma)" },
                { name: "Strategy Long Entry", code: 'strategy.entry("Long", strategy.long)' },
                { name: "Strategy Close", code: 'strategy.close("Long")' },
              ].map((item) => (
                <button
                  key={item.name}
                  onClick={() => insertSnippet(item.code)}
                  style={{
                    textAlign: "left",
                    background: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: "4px",
                    padding: "6px 8px",
                    color: "rgba(255, 255, 255, 0.8)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ fontWeight: 600, color: "#00F5A0", fontSize: "10px" }}>{item.name}</div>
                  <div style={{ fontFamily: "monospace", fontSize: "9px", color: "rgba(255,255,255,0.5)", marginTop: "2px" }}>
                    {item.code.slice(0, 32)}...
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Status Bar */}
        <div
          style={{
            padding: "8px 16px",
            background: "#141A29",
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "11px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {status.type === "error" ? (
              <AlertCircle size={14} color="#FF495C" />
            ) : status.type === "success" ? (
              <CheckCircle2 size={14} color="#00F5A0" />
            ) : null}
            <span
              style={{
                color: status.type === "error" ? "#FF495C" : status.type === "success" ? "#00F5A0" : "rgba(255,255,255,0.6)",
                fontWeight: 600,
              }}
            >
              {status.msg}
            </span>
          </div>

          <div style={{ color: "rgba(255,255,255,0.4)" }}>
            Lines: {code.split("\n").length} | Characters: {code.length}
          </div>
        </div>
      </div>
    </div>
  );
};
