import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Run the Binance backend server from binance-charts
process.env.PORT = process.env.PORT || "3002";
import("../../../binance-charts/server/index");
