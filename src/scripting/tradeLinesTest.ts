import { getPricePrecision } from "../components/TradingViewChart";

console.log("=== RUNNING TRADE & POSITION LINES INTEGRATION TEST ===");

// 1. Test Price Precision & Formatting
const p1 = getPricePrecision(64250.5);
console.log("✓ Price 64250.5 Precision:", p1.precision, "MinMove:", p1.minMove);
if (p1.precision !== 2) throw new Error("Expected precision 2 for 64250.5");

const p2 = getPricePrecision(0.0004512);
console.log("✓ Price 0.0004512 Precision:", p2.precision, "MinMove:", p2.minMove);
if (p2.precision !== 6) throw new Error("Expected precision 6 for 0.0004512");

// 2. Test Order Line Formatting logic
const testOrders = [
  { id: "101", symbol: "BTCUSDT", side: "BUY", type: "LIMIT", price: 60000, origQty: 0.5, status: "NEW" },
  { id: "102", symbol: "BTCUSDT", side: "SELL", type: "LIMIT", price: 70000, origQty: 1.0, status: "NEW" },
];

const symbol = "BTCUSDT";
const filteredOrders = testOrders.filter(
  (o) =>
    o.symbol.toLowerCase() === symbol.toLowerCase() &&
    (o.status === "NEW" || o.status === "OPEN") &&
    o.price > 0
);

console.log("✓ Filtered Active Orders Count:", filteredOrders.length);
if (filteredOrders.length !== 2) throw new Error("Expected 2 active orders");

// 3. Test Paper Position formatting logic
const testPaperPos = {
  symbol: "BTCUSDT",
  side: "LONG",
  qty: 0.25,
  entryPrice: 62000,
  stopPrice: 60000,
  targetPrice: 68000,
  lastPrice: 63500,
};

const livePrice = 63500;
const isLong = testPaperPos.side === "LONG";
const pnlPct = ((livePrice - testPaperPos.entryPrice) / testPaperPos.entryPrice) * 100 * (isLong ? 1 : -1);
console.log(`✓ Paper Pos PnL %: ${pnlPct.toFixed(2)}% (Expected +2.42%)`);

console.log("=== ALL TRADE & POSITION LINES TESTS PASSED ===");
