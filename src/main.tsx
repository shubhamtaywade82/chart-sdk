import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

// Dynamic app selection via Vite define — set by VITE_APP env var at build time.
// This means ZERO dead code in the bundle: only one adapter ships per build.
declare const __VITE_APP__: string;

async function bootstrap() {
  const appId = typeof __VITE_APP__ !== "undefined" ? __VITE_APP__ : "binance";

  let AppComponent: React.ComponentType;

  if (appId === "dhanhq") {
    const mod = await import("./apps/dhanhq/App");
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

bootstrap();
