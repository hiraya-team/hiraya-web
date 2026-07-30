import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { seededDesktopPlugin } from "./build/seeded";
import { systemAppsPlugin } from "./build/system-apps";
import { navigationFallbackDenylist } from "./build/navigation";
import { appsUiRuntimePlugin } from "./build/apps-ui-runtime";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "HIRAYA_");
  const historyLimit = env.HIRAYA_HISTORY_LIMIT ? Number(env.HIRAYA_HISTORY_LIMIT) : 1000;
  if (!Number.isSafeInteger(historyLimit) || historyLimit <= 0) throw new Error("HIRAYA_HISTORY_LIMIT must be a positive integer.");
  return {
    base: env.HIRAYA_BASE_PATH || "/",
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
      VitePWA({
        injectRegister: null,
        registerType: "prompt",
        useCredentials: true,
        includeAssets: ["favicon.png", "apple-touch-icon.png", "logo.png"],
        manifest: {
          name: "Hiraya Desktop",
          short_name: "Hiraya",
          description: "A private, browser-native desktop for your files.",
          theme_color: "#24333b",
          background_color: "#172329",
          display: "standalone",
          start_url: ".",
          scope: ".",
          icons: [
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            { src: "pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          globPatterns: ["**/*.{js,css,html,ico,png,svg,wasm,webmanifest,json}"],
          navigateFallbackDenylist: navigationFallbackDenylist,
        },
      }),
    ],
    server: {
      allowedHosts: [".exe.xyz"],
      headers: {
        "Cache-Control": "no-store",
      },
      proxy: {
        "/api": "http://127.0.0.1:8080",
      },
    },
    optimizeDeps: {
      exclude: ["@sqlite.org/sqlite-wasm"],
    },
    build: {
      manifest: true,
    },
  };
});
