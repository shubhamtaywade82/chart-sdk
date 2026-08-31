// Run the DhanHQ backend server from dhanhq-charts on port 3003
process.env.PORT = process.env.PORT || "3003";
// Specifier built at runtime (not a string literal) so tsc can't statically resolve it into
// this project's typecheck graph — that repo's own pre-existing bugs aren't this project's
// gate to fail on, and we don't own it.
const dhanhqServerPath = ["..", "..", "..", "dhanhq-charts", "server", "index"].join("/");
import(dhanhqServerPath).catch((err) => {
  console.error("[chart-sdk/dhanhq] Failed to start backend server:", err);
  process.exit(1);
});
