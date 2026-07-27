import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

type ManifestItem = { file: string; css?: string[]; imports?: string[]; isEntry?: boolean };

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const manifest = JSON.parse(await readFile(path.join(DIST, ".vite", "manifest.json"), "utf8")) as Record<string, ManifestItem>;
const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
if (!entryKey) throw new Error("Bundle budget could not find the application entry chunk.");

const initialKeys = new Set<string>();
function includeInitial(key: string) {
  if (initialKeys.has(key)) return;
  initialKeys.add(key);
  for (const dependency of manifest[key]?.imports ?? []) includeInitial(dependency);
}
includeInitial(entryKey);

const gzipSize = async (file: string) => gzipSync(await readFile(path.join(DIST, file))).byteLength;
const initialJs = await Promise.all([...initialKeys].map((key) => gzipSize(manifest[key].file)));
const initialCssFiles = new Set([...initialKeys].flatMap((key) => manifest[key].css ?? []));
const initialCss = await Promise.all([...initialCssFiles].map(gzipSize));
const assetFiles = (await readdir(path.join(DIST, "assets"))).filter((file) => file.endsWith(".js"));
const javascript = await Promise.all(assetFiles.map(async (file) => ({ file, gzip: await gzipSize(`assets/${file}`), raw: (await stat(path.join(DIST, "assets", file))).size })));

const budgets = [
  { label: "initial JavaScript gzip", actual: initialJs.reduce((total, size) => total + size, 0), limit: 180 * 1024 },
  { label: "initial CSS gzip", actual: initialCss.reduce((total, size) => total + size, 0), limit: 50 * 1024 },
  { label: "largest JavaScript chunk gzip", actual: Math.max(...javascript.map((item) => item.gzip)), limit: 320 * 1024 },
  { label: "total JavaScript gzip", actual: javascript.reduce((total, item) => total + item.gzip, 0), limit: 1400 * 1024 },
];

const failures = budgets.filter((budget) => budget.actual > budget.limit);
for (const budget of budgets) console.log(`${budget.label}: ${(budget.actual / 1024).toFixed(1)} KiB / ${(budget.limit / 1024).toFixed(0)} KiB`);
if (failures.length) throw new Error(`Bundle budget exceeded: ${failures.map((budget) => budget.label).join(", ")}.`);

const largest = javascript.sort((left, right) => right.gzip - left.gzip)[0];
console.log(`largest chunk: ${largest.file} (${(largest.raw / 1024).toFixed(1)} KiB raw)`);
