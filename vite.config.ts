import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig(() => {
  const base = process.env.HIRAYA_BASE_PATH || "/";
  if (!base.startsWith("/") || !base.endsWith("/")) throw new Error("HIRAYA_BASE_PATH must start and end with '/'.");
  return {
    base,
    plugins: [solid()],
    server: {
      allowedHosts: [".exe.xyz"],
      headers: { "Cache-Control": "no-store" },
      proxy: { "/api": "http://127.0.0.1:8080" },
    },
    build: { manifest: true },
  };
});
