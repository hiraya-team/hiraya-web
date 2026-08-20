import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

type ManifestItem = { file: string; name?: string; src?: string; css?: string[]; imports?: string[]; dynamicImports?: string[]; isEntry?: boolean };
type Measurement = { label: string; actual: number; limit: number; exclusive?: boolean };

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const manifest = JSON.parse(await readFile(path.join(DIST, ".vite", "manifest.json"), "utf8")) as Record<string, ManifestItem>;
const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry && manifest[key].src === "index.html");
if (!entryKey) throw new Error("Bundle budget could not find the application entry chunk.");

const keyFor = (source: string) => Object.keys(manifest).find((key) => key === source || manifest[key].src === source || manifest[key].name === source);
const closure = (roots: Array<string | undefined>) => {
  const keys = new Set<string>();
  const include = (key: string | undefined) => {
    if (!key || keys.has(key) || !manifest[key]) return;
    keys.add(key);
    for (const dependency of manifest[key].imports ?? []) include(dependency);
  };
  roots.forEach(include);
  return keys;
};
const gzipSize = async (file: string) => gzipSync(await readFile(path.join(DIST, file))).byteLength;
const sumFiles = async (files: Iterable<string>) => (await Promise.all([...new Set(files)].map(gzipSize))).reduce((total, size) => total + size, 0);
const filesFor = (keys: Iterable<string>, field: "file" | "css") => [...keys].flatMap((key) => field === "file" ? [manifest[key].file] : manifest[key].css ?? []);

const startupKey = keyFor("src/shell/startup.ts");
if (!startupKey) throw new Error("Bundle budget could not find the automatic shell startup module.");
const startupDynamicImports = manifest[startupKey].dynamicImports ?? [];
const contingencySources = new Set(["src/lib/auth.ts", "src/platform/storage/synchronized-session.ts"]);
const contingencyRoots = startupDynamicImports.filter((key) => contingencySources.has(manifest[key]?.src ?? key));
const interactiveKeys = closure([entryKey, startupKey, ...startupDynamicImports.filter((key) => !contingencyRoots.includes(key))]);
const contingencyKeys = new Set([...closure(contingencyRoots)].filter((key) => !interactiveKeys.has(key)));
const initialKeys = new Set([...interactiveKeys, ...contingencyKeys]);
const interactiveJavaScript = await sumFiles(filesFor(interactiveKeys, "file"));
const initialCssFiles = filesFor(initialKeys, "css");
const initialCss = await sumFiles(initialCssFiles);
const serviceWorker = await gzipSize("sw.js");
const startupResources = await sumFiles(["index.html", "manifest.webmanifest", "hiraya-icon.svg"]);
const contingency = await sumFiles(filesFor(contingencyKeys, "file"));
const completeShell = interactiveJavaScript + initialCss + serviceWorker + startupResources + contingency;

const assetFiles = await readdir(path.join(DIST, "assets"));
const javascript = await Promise.all(assetFiles.filter((file) => file.endsWith(".js")).map(async (file) => ({ file, gzip: await gzipSize(`assets/${file}`), raw: (await stat(path.join(DIST, "assets", file))).size })));
const featureCssFiles = assetFiles.filter((file) => file.endsWith(".css") && !initialCssFiles.includes(`assets/${file}`));
const featureCss = await Promise.all(featureCssFiles.map(async (file) => ({ file, gzip: await gzipSize(`assets/${file}`) })));

const measurements: Measurement[] = [
  { label: "interactive JavaScript gzip", actual: interactiveJavaScript, limit: 50 * 1024 },
  { label: "initial CSS gzip", actual: initialCss, limit: 15 * 1024 },
  { label: "service worker gzip", actual: serviceWorker, limit: 10 * 1024 },
  { label: "HTML + manifest + startup icons gzip", actual: startupResources, limit: 5 * 1024 },
  { label: "contingency", actual: contingency, limit: 20 * 1024 },
  { label: "complete initial shell gzip", actual: completeShell, limit: 100 * 1024, exclusive: true },
  { label: "largest JavaScript chunk gzip", actual: Math.max(...javascript.map((item) => item.gzip)), limit: 320 * 1024 },
  { label: "total JavaScript gzip", actual: javascript.reduce((total, item) => total + item.gzip, 0), limit: 1400 * 1024 },
  { label: "largest feature CSS gzip", actual: Math.max(0, ...featureCss.map((item) => item.gzip)), limit: 50 * 1024 },
];

const featureSources = [
  "src/components/TextEditor.tsx",
  "src/components/ImagePreview.tsx",
  "src/components/MarkdownRenderer.tsx",
  "src/lib/format-text.ts",
  "src/components/SettingsWindow.tsx",
  "src/components/SharingDialog.tsx",
  "src/components/PropertiesWindow.tsx",
  "src/components/MergeWindow.tsx",
  "src/features/app-management/SandboxFrame.tsx",
  "src/components/AppStoreWindow.tsx",
  "src/lib/seeded.ts",
];
for (const source of featureSources) {
  const key = keyFor(source);
  if (!key) throw new Error(`Bundle budget could not find lazy feature ${source}.`);
  const keys = closure([key]);
  const size = await sumFiles(filesFor([...keys].filter((item) => !initialKeys.has(item)), "file"));
  measurements.push({ label: `lazy ${path.basename(source)} journey gzip`, actual: size, limit: 320 * 1024 });
}

const systemAppLimits: Record<string, number> = {
  "file-viewer.hiraya.app": 12989,
  "image-viewer.hiraya.app": 13238,
  "media-viewer.hiraya.app": 1054213,
  "terminal.hiraya.app": 20415,
  "text-editor.hiraya.app": 350723,
  "theme-editor.hiraya.app": 22771,
};
for (const [file, limit] of Object.entries(systemAppLimits)) measurements.push({ label: `system app ${file}`, actual: (await stat(path.join(DIST, "system-apps", file))).size, limit });

const forbiddenInitial = /(?:Desktop\.tsx|PublicDesktop|editor|viewer|markdown|prettier|format-text|settings|sharing|properties|merge|sandbox|archive|seeded)/i;
const forbidden = [...initialKeys].filter((key) => forbiddenInitial.test(`${key} ${manifest[key].name ?? ""} ${manifest[key].src ?? ""}`));
if (forbidden.length) throw new Error(`Lazy feature entered the interactive closure: ${forbidden.join(", ")}.`);
const shellSource = await readFile(path.resolve(DIST, "..", "src", "shell", "Shell.tsx"), "utf8");
if (/requestIdleCallback|setTimeout\s*\(/.test(shellSource)) throw new Error("The React shell contains an automatic timed upgrade path.");

for (const item of measurements) console.log(`${item.label}: ${item.actual} B (${(item.actual / 1024).toFixed(2)} KiB) / ${item.exclusive ? "< " : "<= "}${item.limit} B`);
const failures = measurements.filter((item) => item.exclusive ? item.actual >= item.limit : item.actual > item.limit);
if (failures.length) throw new Error(`Bundle budget exceeded: ${failures.map((item) => item.label).join(", ")}.`);

const largest = javascript.sort((left, right) => right.gzip - left.gzip)[0];
console.log(`largest chunk: ${largest.file} (${largest.raw} B raw)`);
