import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: {
        index: path.resolve(__dirname, "src/index.ts"),
        core: path.resolve(__dirname, "src/core.ts"),
      },
      name: "ChartSDK",
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "lightweight-charts",
        "lucide-react",
        "@monaco-editor/react",
        "axios",
        "ws",
      ],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          "lightweight-charts": "LightweightCharts",
          "lucide-react": "LucideReact",
        },
      },
    },
    outDir: "dist",
    emptyOutDir: false,
  },
});
