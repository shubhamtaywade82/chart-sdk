// Run the DhanHQ backend server from dhanhq-charts on port 3003
process.env.PORT = process.env.PORT || "3003";
import("../../../dhanhq-charts/server/index").catch((err) => {
  console.error("[chart-sdk/dhanhq] Failed to start backend server:", err);
  process.exit(1);
});
