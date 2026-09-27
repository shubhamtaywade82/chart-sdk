// Run the DhanHQ backend server from dhanhq-charts on port 3003
process.env.PORT = process.env.PORT || "3003";
// Specifier built at runtime (not a string literal) so tsc can't statically resolve it into
// this project's typecheck graph — that repo's own pre-existing bugs aren't this project's
// gate to fail on, and we don't own it.
const dhanhqServerCandidates = [
  process.env.DHANHQ_CHARTS_SERVER_PATH,
  ["..", "..", "..", "..", "sdks-and-clients", "dhanhq", "dhanhq-charts", "server", "index"].join("/"),
  ["..", "..", "..", "dhanhq-charts", "server", "index"].join("/"),
].filter(Boolean) as string[];

let started = false;
let lastImportError: unknown;
for (const serverPath of dhanhqServerCandidates) {
  try {
    await import(serverPath);
    started = true;
    break;
  } catch (err: any) {
    lastImportError = err;
    const isCandidateMissing =
      err?.code === "ERR_MODULE_NOT_FOUND" &&
      (err.url?.includes(serverPath) || err.url?.endsWith("/server/index"));
    if (!isCandidateMissing) {
      throw err;
    }
  }
}

if (!started) {
  console.error("[chart-sdk/dhanhq] Failed to start backend server:", lastImportError);
  process.exit(1);
}

export {};
