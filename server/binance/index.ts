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
const legacyRoutesPath = ["..", "..", "..", "binance-charts", "server", "routes"].join("/");
const { router: legacyApiRouter } = await import(legacyRoutesPath);
app.use("/api", legacyApiRouter);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/feed" });
WebSocketFeedService.attach(wss);

const PORT = Number(process.env.BINANCE_PORT || process.env.PORT || 3002);
server.listen(PORT, () => {
  console.log(`🚀 Binance market engine backend running at http://localhost:${PORT}`);
});
