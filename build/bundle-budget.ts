import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

type ManifestItem = { file: string; name?: string; src?: string; css?: string[]; imports?: string[]; dynamicImports?: string[]; isEntry?: boolean };
type Measurement = { label: string; actual: number; limit: number; exclusive?: boolean };

/** Locates the production build output. */
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
/** Reads the Vite build manifest. */
const manifest = JSON.parse(await readFile(path.join(DIST, ".vite", "manifest.json"), "utf8")) as Record<string, ManifestItem>;
/** Identifies the main application manifest entry. */
const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry && manifest[key].src === "index.html");
if (!entryKey) throw new Error("Bundle budget could not find the application entry chunk.");

/** Finds the manifest key for a source file. */
const keyFor = (source: string) => Object.keys(manifest).find((key) => key === source || manifest[key].src === source || manifest[key].name === source);
/** Collects a manifest entry and its transitive imports. */
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
/** Returns a built file's compressed size. */
const gzipSize = async (file: string) => gzipSync(await readFile(path.join(DIST, file))).byteLength;
/** Sums the compressed size of built files. */
const sumFiles = async (files: Iterable<string>) => (await Promise.all([...new Set(files)].map(gzipSize))).reduce((total, size) => total + size, 0);
/** Collects files of a given type from manifest entries. */
const filesFor = (keys: Iterable<string>, field: "file" | "css") => [...keys].flatMap((key) => field === "file" ? [manifest[key].file] : manifest[key].css ?? []);

/** Identifies the startup shell manifest entry. */
const startupKey = keyFor("src/shell/startup.ts");
if (!startupKey) throw new Error("Bundle budget could not find the automatic shell startup module.");
/** Lists dynamic imports reachable from startup. */
const startupDynamicImports = manifest[startupKey].dynamicImports ?? [];
/** Lists startup sources reserved for contingency paths. */
const contingencySources = new Set(["src/lib/auth.ts", "src/platform/storage/synchronized-session.ts"]);
/** Identifies contingency import roots. */
const contingencyRoots = startupDynamicImports.filter((key) => contingencySources.has(manifest[key]?.src ?? key));
/** Collects manifest entries needed for the interactive shell. */
const interactiveKeys = closure([entryKey, startupKey, ...startupDynamicImports.filter((key) => !contingencyRoots.includes(key))]);
/** Collects manifest entries used only by contingency paths. */
const contingencyKeys = new Set([...closure(contingencyRoots)].filter((key) => !interactiveKeys.has(key)));
/** Collects all manifest entries loaded by the initial shell. */
const initialKeys = new Set([...interactiveKeys, ...contingencyKeys]);
/** Measures interactive shell JavaScript. */
const interactiveJavaScript = await sumFiles(filesFor(interactiveKeys, "file"));
/** Lists CSS files loaded by the initial shell. */
const initialCssFiles = filesFor(initialKeys, "css");
/** Measures CSS loaded by the initial shell. */
const initialCss = await sumFiles(initialCssFiles);
/** Measures the built service worker. */
const serviceWorker = await gzipSize("sw.js");
/** Measures non-code startup resources. */
const startupResources = await sumFiles(["index.html", "manifest.webmanifest", "hiraya-icon.svg"]);
/** Measures contingency-path resources. */
const contingency = await sumFiles(filesFor(contingencyKeys, "file"));
/** Measures the complete initial shell. */
const completeShell = interactiveJavaScript + initialCss + serviceWorker + startupResources + contingency;

/** Lists files in the built asset directory. */
const assetFiles = await readdir(path.join(DIST, "assets"));
/** Measures each built JavaScript asset. */
const javascript = await Promise.all(assetFiles.filter((file) => file.endsWith(".js")).map(async (file) => ({ file, gzip: await gzipSize(`assets/${file}`), raw: (await stat(path.join(DIST, "assets", file))).size })));
/** Lists CSS loaded outside the initial shell. */
const featureCssFiles = assetFiles.filter((file) => file.endsWith(".css") && !initialCssFiles.includes(`assets/${file}`));
/** Measures each feature CSS asset. */
const featureCss = await Promise.all(featureCssFiles.map(async (file) => ({ file, gzip: await gzipSize(`assets/${file}`) })));

/** Collects bundle measurements and their limits. */
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

/** Lists feature entrypoints with separate journey budgets. */
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

/** Defines the system app limits. */
const systemAppLimits: Record<string, number> = {
  "file-viewer.hiraya.app": 12989,
  "image-viewer.hiraya.app": 13238,
  "media-viewer.hiraya.app": 1054213,
  "terminal.hiraya.app": 20415,
  "text-editor.hiraya.app": 350723,
  "theme-editor.hiraya.app": 22789,
};
for (const [file, limit] of Object.entries(systemAppLimits)) measurements.push({ label: `system app ${file}`, actual: (await stat(path.join(DIST, "system-apps", file))).size, limit });

/** Matches feature code forbidden from the initial bundle. */
const forbiddenInitial = /(?:Desktop\.tsx|PublicDesktop|editor|viewer|markdown|prettier|format-text|settings|sharing|properties|merge|sandbox|archive|seeded)/i;
/** Lists forbidden modules found in the initial bundle. */
const forbidden = [...initialKeys].filter((key) => forbiddenInitial.test(`${key} ${manifest[key].name ?? ""} ${manifest[key].src ?? ""}`));
if (forbidden.length) throw new Error(`Lazy feature entered the interactive closure: ${forbidden.join(", ")}.`);
/** Reads the shell source for delayed-upgrade checks. */
const shellSource = await readFile(path.resolve(DIST, "..", "src", "shell", "Shell.tsx"), "utf8");
if (/requestIdleCallback|setTimeout\s*\(/.test(shellSource)) throw new Error("The React shell contains an automatic timed upgrade path.");

for (const item of measurements) console.log(`${item.label}: ${item.actual} B (${(item.actual / 1024).toFixed(2)} KiB) / ${item.exclusive ? "< " : "<= "}${item.limit} B`);
/** Collects bundle-budget failures. */
const failures = measurements.filter((item) => item.exclusive ? item.actual >= item.limit : item.actual > item.limit);
if (failures.length) throw new Error(`Bundle budget exceeded: ${failures.map((item) => item.label).join(", ")}.`);

/** Selects the largest JavaScript assets for reporting. */
const largest = javascript.sort((left, right) => right.gzip - left.gzip)[0];
console.log(`largest chunk: ${largest.file} (${largest.raw} B raw)`);
