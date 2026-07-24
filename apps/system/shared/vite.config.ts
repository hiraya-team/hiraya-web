import { defineConfig } from "vite";

export function systemAppConfig() {
  return defineConfig({
    base: "./",
    build: {
      assetsDir: "assets",
      emptyOutDir: true,
      sourcemap: false,
    },
  });
}
