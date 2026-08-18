import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { seededDesktopPlugin } from "./build/seeded";
import { systemAppsPlugin } from "./build/system-apps";
import { appsUiRuntimePlugin } from "./build/apps-ui-runtime";
import { serviceWorkerPlugin } from "./build/service-worker";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "HIRAYA_"), ...process.env };
  const historyLimit = env.HIRAYA_HISTORY_LIMIT ? Number(env.HIRAYA_HISTORY_LIMIT) : 1000;
  if (!Number.isSafeInteger(historyLimit) || historyLimit <= 0) throw new Error("HIRAYA_HISTORY_LIMIT must be a positive integer.");
  const base = env.HIRAYA_BASE_PATH || "/";
  return {
    base,
    define: {
      "import.meta.env.HIRAYA_BUILD_TIMESTAMP": JSON.stringify(new Date().toISOString()),
      "import.meta.env.HIRAYA_FRONTEND_ONLY": JSON.stringify(env.HIRAYA_FRONTEND_ONLY === "true" ? "true" : "false"),
      "import.meta.env.HIRAYA_HISTORY_LIMIT": JSON.stringify(String(historyLimit)),
    },
    plugins: [
      appsUiRuntimePlugin(process.cwd()),
      seededDesktopPlugin(process.cwd(), env.HIRAYA_SEEDED_DIR),
      systemAppsPlugin(process.cwd()),
      react(),
      serviceWorkerPlugin(base),
    ],
    server: {
      allowedHosts: [".exe.xyz"],
      headers: {
        "Cache-Control": "no-store",
      },
      proxy: {
        "/api": "http://127.0.0.1:8080",
        "/r": "http://127.0.0.1:8080",
      },
    },
    build: {
      manifest: true,
      modulePreload: false,
      minify: "terser",
      terserOptions: { module: true, compress: { passes: 3 } },
      rollupOptions: {
        input: {
          app: path.resolve(process.cwd(), "index.html"),
          sw: path.resolve(process.cwd(), "src/sw.ts"),
        },
        output: {
          entryFileNames: (chunk) => chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
          manualChunks(id) {
            if (/\/src\/(?:filesystem\/ids|lib\/publication-alias|platform\/storage\/account-storage)\.ts$/.test(id)) return "startup-shared";
            if (id.includes("/node_modules/") && (id.includes("/@codemirror/") || id.includes("/codemirror/") || id.includes("/@lezer/"))) return "editor-runtime";
          },
        },
      },
    },
  };
});
