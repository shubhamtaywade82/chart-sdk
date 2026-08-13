import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

// Dynamic app selection via Vite define — set by VITE_APP env var at build time.
// This means ZERO dead code in the bundle: only one adapter ships per build.
declare const __VITE_APP__: string;

async function bootstrap() {
  const appId = typeof __VITE_APP__ !== "undefined" ? __VITE_APP__ : "binance";

  // Set document title per app so DhanHQ tab doesn't show Binance branding
  document.title = appId === "dhanhq"
    ? "DhanHQ Pro Trading Terminal"
    : appId === "coindcx"
      ? "CoinDCX Pro Trading Terminal"
      : "Crypto Pro Terminal — Binance Market Data & Multi-Broker";

  let AppComponent: React.ComponentType;

  if (appId === "dhanhq") {
    const mod = await import("./apps/dhanhq/App");
    AppComponent = mod.default ?? mod.App;
  } else if (appId === "coindcx") {
    const mod = await import("./apps/coindcx/App");
    AppComponent = mod.default ?? mod.App;
  } else {
    const mod = await import("./apps/binance/App");
    AppComponent = mod.default ?? mod.App;
  }

  const root = document.getElementById("root");
  if (!root) throw new Error("#root element not found");
  createRoot(root).render(
    <React.StrictMode>
      <AppComponent />
    </React.StrictMode>
  );
}

bootstrap().catch((err) => {
  console.error("[chart-sdk] Bootstrap failed:", err);
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `<div style="color:#ff4d4f;padding:40px;font-family:monospace">Failed to load application: ${err?.message ?? err}</div>`;
  }
});
