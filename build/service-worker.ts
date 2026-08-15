import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

declare const Bun: {
  build(options: { entrypoints: string[]; outdir: string; naming: string; target: "browser"; minify: boolean; define: Record<string, string> }): Promise<{ success: boolean; logs: unknown[] }>;
};

type ManifestItem = { file: string; css?: string[]; imports?: string[]; dynamicImports?: string[]; isEntry?: boolean };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const manifest = JSON.parse(await readFile(path.join(dist, ".vite", "manifest.json"), "utf8")) as Record<string, ManifestItem>;
const entry = Object.keys(manifest).find((key) => manifest[key].isEntry);
if (!entry) throw new Error("Service-worker build could not find the shell entry.");

const closure = new Set<string>();
function include(key: string) {
  if (closure.has(key)) return;
  const item = manifest[key];
  if (!item) throw new Error(`Service-worker build could not resolve ${key}.`);
  if (item.dynamicImports?.length) throw new Error("Phase 0 does not permit dynamic shell imports.");
  closure.add(key);
  for (const dependency of item.imports ?? []) include(dependency);
}
include(entry);

const base = process.env.HIRAYA_BASE_PATH || "/";
if (!base.startsWith("/") || !base.endsWith("/")) throw new Error("HIRAYA_BASE_PATH must start and end with '/'.");
const files = new Set(["index.html", "manifest.webmanifest", "icon.svg"]);
for (const key of closure) {
  files.add(manifest[key].file);
  for (const css of manifest[key].css ?? []) files.add(css);
}
const orderedFiles = [...files].sort();
const cachePrefix = `hiraya-shell-${createHash("sha256").update(base).digest("hex").slice(0, 8)}-`;
const revision = createHash("sha256");
for (const file of orderedFiles) {
  revision.update(file);
  revision.update(await readFile(path.join(dist, file)));
}
const result = await Bun.build({
  entrypoints: [path.join(root, "src", "sw.ts")],
  outdir: dist,
  naming: "sw.js",
  target: "browser",
  minify: true,
  define: {
    __HIRAYA_BASE_PATH__: JSON.stringify(base),
    __HIRAYA_CACHE_PREFIX__: JSON.stringify(cachePrefix),
    __HIRAYA_CACHE_NAME__: JSON.stringify(`${cachePrefix}${revision.digest("hex").slice(0, 16)}`),
    __HIRAYA_PRECACHE__: JSON.stringify(orderedFiles.map((file) => `${base}${file}`)),
  },
});
if (!result.success) throw new Error(result.logs.map(String).join("\n"));
