import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@hiraya/apps-ui/elements/primitives": fileURLToPath(new URL("../../packages/apps-ui/src/elements/primitives.ts", import.meta.url)),
      "@hiraya/apps-ui/styles.css": fileURLToPath(new URL("../../packages/apps-ui/src/styles.css", import.meta.url)),
      "@hiraya/apps-ui": fileURLToPath(new URL("../../packages/apps-ui/src/index.ts", import.meta.url)),
      "@hiraya/apps-sdk": fileURLToPath(new URL("../../packages/apps-sdk/src/index.ts", import.meta.url)),
    },
  },
});
