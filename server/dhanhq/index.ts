import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Run the DhanHQ backend server from dhanhq-charts on port 3003
process.env.PORT = process.env.PORT || "3003";
import("../../../dhanhq-charts/server/index");
