import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import { WebSocketFeedService } from "./websocket-feed.service";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Legacy REST surface (session-info, funds, positions, orders, trader-controls/killswitch, etc.)
// intentionally stays on the sibling binance-charts server; this sub-project's scope is
// market-data/WS only. Router is self-contained — does not import the retired 1s-poll feed
// service. Specifier is built at runtime (not a string literal) so tsc can't statically resolve
// it into this project's typecheck graph — that repo's own pre-existing bugs aren't this
// project's gate to fail on, and we don't own it.
const legacyRoutesCandidates = [
  process.env.BINANCE_CHARTS_ROUTES_PATH,
  ["..", "..", "..", "..", "sdks-and-clients", "binance", "binance-charts", "server", "routes"].join("/"),
  ["..", "..", "..", "binance-charts", "server", "routes"].join("/"),
].filter(Boolean) as string[];

let legacyApiRouter: any;
let lastImportError: unknown;
for (const routesPath of legacyRoutesCandidates) {
  try {
    const mod = await import(routesPath);
    legacyApiRouter = mod.router;
    break;
  } catch (err: any) {
    lastImportError = err;
    const isCandidateMissing =
      err?.code === "ERR_MODULE_NOT_FOUND" &&
      (err.url?.includes(routesPath) || err.url?.endsWith("/server/routes"));
    if (!isCandidateMissing) {
      throw err;
    }
  }
}

if (!legacyApiRouter) {
  throw lastImportError ?? new Error("Could not find binance-charts server/routes in candidate locations.");
}
app.use("/api", legacyApiRouter);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/feed" });
WebSocketFeedService.attach(wss);

const PORT = Number(process.env.BINANCE_PORT || process.env.PORT || 3002);
server.listen(PORT, () => {
  console.log(`🚀 Binance market engine backend running at http://localhost:${PORT}`);
});
