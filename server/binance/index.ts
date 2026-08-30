import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import { WebSocketFeedService } from "./websocket-feed.service";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/feed" });
WebSocketFeedService.attach(wss);

const PORT = Number(process.env.BINANCE_PORT || process.env.PORT || 3002);
server.listen(PORT, () => {
  console.log(`🚀 Binance market engine backend running at http://localhost:${PORT}`);
});
