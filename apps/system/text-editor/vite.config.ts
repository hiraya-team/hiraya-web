import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig } from "vite";

const beautifier = readFileSync(createRequire(import.meta.url).resolve("js-beautify/js/lib/beautifier.min.js"), "utf8");

export default defineConfig({
  base: "./",
  plugins: [{
    name: "inline-beautifier",
    transformIndexHtml: { order: "pre", handler: () => [{ tag: "script", children: beautifier, injectTo: "head" }] },
  }],
});
