import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

type ManifestItem = { file: string; css?: string[]; imports?: string[]; dynamicImports?: string[]; isEntry?: boolean };
type Budget = { label: string; files: Set<string>; limit: number };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const manifest = JSON.parse(await readFile(path.join(dist, ".vite", "manifest.json"), "utf8")) as Record<string, ManifestItem>;
const entry = Object.keys(manifest).find((key) => manifest[key].isEntry);
if (!entry) throw new Error("Bundle budget could not find the shell entry.");

const closure = new Set<string>();
function include(key: string) {
  if (closure.has(key)) return;
  const item = manifest[key];
  if (!item) throw new Error(`Bundle budget could not resolve ${key}.`);
  if (item.dynamicImports?.length) throw new Error("Phase 0 does not permit dynamic shell imports.");
  closure.add(key);
  for (const dependency of item.imports ?? []) include(dependency);
}
include(entry);

const forbidden = /(?:editor|viewer|installer|app-runtime|application-host|markdown|prettier|formatter|merge-recovery)/i;
for (const [key, item] of Object.entries(manifest)) if (forbidden.test(key) || forbidden.test(item.file)) throw new Error(`Forbidden shell module: ${key}.`);

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { workspaces?: unknown; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
if (packageJson.workspaces) throw new Error("Phase 0 must not define package workspaces.");
const dependencies = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
const forbiddenDependency = /(?:react|codemirror|workbox|markdown|prettier|diff3|fflate|@hiraya)/i;
const rejected = dependencies.filter((dependency) => forbiddenDependency.test(dependency));
if (rejected.length) throw new Error(`Forbidden Phase 0 dependencies: ${rejected.join(", ")}.`);

const javascript = new Set([...closure].map((key) => manifest[key].file));
const css = new Set([...closure].flatMap((key) => manifest[key].css ?? []));
const documents = new Set(["index.html", "manifest.webmanifest", "icon.svg"]);
const worker = new Set(["sw.js"]);

async function runtimeFiles(directory = dist, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, item.name);
    if (relative.startsWith(".vite/")) continue;
    if (item.isDirectory()) files.push(...await runtimeFiles(path.join(directory, item.name), relative));
    else files.push(relative);
  }
  return files;
}

const classified = new Set([...javascript, ...css, ...documents, ...worker]);
const other = new Set((await runtimeFiles()).filter((file) => !classified.has(file)));
const forbiddenRuntimeFiles = [...classified, ...other].filter((file) => forbidden.test(file));
if (forbiddenRuntimeFiles.length) throw new Error(`Forbidden emitted runtime files: ${forbiddenRuntimeFiles.join(", ")}.`);
if ([...classified, ...other].some((file) => file.endsWith(".map"))) throw new Error("Source maps are not permitted in the Phase 0 runtime.");

const gzipSize = async (file: string) => gzipSync(await readFile(path.join(dist, file))).byteLength;
const size = async (files: Set<string>) => (await Promise.all([...files].map(gzipSize))).reduce((total, bytes) => total + bytes, 0);
const budgets: Budget[] = [
  { label: "initial JavaScript", files: javascript, limit: 50 * 1024 },
  { label: "initial CSS", files: css, limit: 15 * 1024 },
  { label: "service worker", files: worker, limit: 10 * 1024 },
  { label: "HTML, manifest, and icons", files: documents, limit: 5 * 1024 },
  { label: "contingency", files: other, limit: 20 * 1024 },
];

let total = 0;
const failures: string[] = [];
for (const budget of budgets) {
  const actual = await size(budget.files);
  total += actual;
  console.log(`${budget.label}: ${(actual / 1024).toFixed(1)} KiB gzip / ${(budget.limit / 1024).toFixed(0)} KiB`);
  if (actual > budget.limit) failures.push(budget.label);
}
console.log(`total usable shell: ${(total / 1024).toFixed(1)} KiB gzip / <100 KiB`);
if (total >= 100 * 1024) failures.push("total usable shell");
if (failures.length) throw new Error(`Bundle budget exceeded: ${failures.join(", ")}.`);
