// Run the Binance backend server from binance-charts
process.env.PORT = process.env.PORT || "3002";
import("../../../binance-charts/server/index").catch((err) => {
  console.error("[chart-sdk/binance] Failed to start backend server:", err);
  process.exit(1);
});
