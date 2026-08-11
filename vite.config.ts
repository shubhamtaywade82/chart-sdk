import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const app = process.env.VITE_APP || env.VITE_APP || "binance";

  // Each app has its own backend port
  const backendPorts: Record<string, number> = {
    binance: 3002,
    dhanhq:  3003,
    coindcx: 3004,
  };
  const backendPort = backendPorts[app] ?? 3002;

  return {
    plugins: [react()],

    // Dynamic entry point per app — no duplicate HTML files needed
    build: {
      rollupOptions: {
        input: "index.html",
      },
    },

    // Inject the active app into the bundle so main.tsx can pick the right adapter
    define: {
      __VITE_APP__: JSON.stringify(app),
    },

    server: {
      port: app === "dhanhq" ? 5201 : app === "coindcx" ? 5202 : 5200,
      proxy: {
        // Each app's /api and /ws routed to its own backend
        "/api/binance": {
          target: `http://localhost:3002`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/binance/, "/api"),
        },
        "/api/dhanhq": {
          target: `http://localhost:3003`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/dhanhq/, "/api"),
        },
        "/api/coindcx": {
          target: `http://localhost:3004`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/coindcx/, "/api"),
        },
        // Legacy /api pass-through for whichever app is active
        "/api": {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
        "/ws/binance": {
          target: `ws://localhost:3002`,
          ws: true,
          rewrite: (p) => p.replace(/^\/ws\/binance/, "/ws"),
        },
        "/ws/dhanhq": {
          target: `ws://localhost:3003`,
          ws: true,
          rewrite: (p) => p.replace(/^\/ws\/dhanhq/, "/ws"),
        },
        "/ws/coindcx": {
          target: `ws://localhost:3004`,
          ws: true,
          rewrite: (p) => p.replace(/^\/ws\/coindcx/, "/ws"),
        },
        "/ws": {
          target: `ws://localhost:${backendPort}`,
          ws: true,
        },
      },
    },
  };
});
