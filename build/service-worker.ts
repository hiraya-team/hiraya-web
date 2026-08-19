import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

type BuildItem = {
  type: "asset" | "chunk";
  fileName: string;
  name?: string;
  facadeModuleId?: string | null;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  viteMetadata?: { importedCss?: Set<string> };
};

function staticFiles(entry: BuildItem, bundle: Record<string, BuildItem>) {
  const files = new Set<string>();
  const visit = (chunk: BuildItem) => {
    if (files.has(chunk.fileName)) return;
    files.add(chunk.fileName);
    for (const css of chunk.viteMetadata?.importedCss ?? []) files.add(css);
    for (const imported of chunk.imports ?? []) {
      const dependency = bundle[imported];
      if (dependency?.type === "chunk") visit(dependency);
    }
  };
  visit(entry);
  return files;
}

export function serviceWorkerPlugin(base: string): Plugin {
  return {
    name: "hiraya-service-worker",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const worker = Object.values(bundle).find((item) => item.type === "chunk" && item.facadeModuleId?.endsWith("/src/sw.ts"));
      const application = Object.values(bundle).find((item) => item.type === "chunk" && item.isEntry && item !== worker);
      const startup = Object.values(bundle).find((item) => item.type === "chunk" && item.facadeModuleId?.endsWith("/src/shell/startup.ts"));
      const rich = Object.values(bundle).find((item) => item.type === "chunk" && item.facadeModuleId?.endsWith("/src/shell/rich.ts"));
      if (worker?.type !== "chunk" || application?.type !== "chunk" || startup?.type !== "chunk" || rich?.type !== "chunk") throw new Error("The service worker build entries are incomplete.");
      const root = base.endsWith("/") ? base : `${base}/`;
      const startupFiles = new Set<string>();
      for (const chunk of [application, startup]) for (const file of staticFiles(chunk, bundle as Record<string, BuildItem>)) startupFiles.add(file);
      for (const imported of startup.dynamicImports ?? []) {
        const dependency = bundle[imported] as BuildItem | undefined;
        if (dependency?.type === "chunk") for (const file of staticFiles(dependency, bundle as Record<string, BuildItem>)) startupFiles.add(file);
      }
      const forbidden = [...startupFiles].filter((file) => /(?:Desktop|Editor|Viewer|Settings|Markdown|Sharing|Properties|Merge|Sandbox|archive|seeded)/i.test(file));
      if (forbidden.length) throw new Error(`Rich features entered the bootstrap closure: ${forbidden.join(", ")}.`);
      const desktopFiles = new Set(staticFiles(rich, bundle as Record<string, BuildItem>));
      for (const imported of rich.dynamicImports ?? []) {
        const dependency = bundle[imported] as BuildItem | undefined;
        if (dependency?.type !== "chunk") continue;
        for (const file of staticFiles(dependency, bundle as Record<string, BuildItem>)) desktopFiles.add(file);
        if (!dependency.facadeModuleId?.endsWith("/src/platform/storage/desktop-runtime.ts")) continue;
        for (const runtimeImport of dependency.dynamicImports ?? []) {
          const runtime = bundle[runtimeImport] as BuildItem | undefined;
          if (runtime?.type === "chunk") for (const file of staticFiles(runtime, bundle as Record<string, BuildItem>)) desktopFiles.add(file);
        }
      }
      const precache = [root, `${root}manifest.webmanifest`, `${root}hiraya-icon.svg`, ...new Set([...startupFiles, ...desktopFiles].map((file) => `${root}${file}`))];
      const versionHash = createHash("sha256").update(precache.join("\n"));
      for (const file of ["index.html", "public/manifest.webmanifest", "public/hiraya-icon.svg"]) versionHash.update(readFileSync(path.resolve(process.cwd(), file)));
      const version = versionHash.digest("hex").slice(0, 16);
      worker.code = worker.code
        .replace('"/__HIRAYA_PRECACHE__"', precache.map((url) => JSON.stringify(url)).join(","))
        .replace("__HIRAYA_CACHE_VERSION__", version);
      if (worker.code.includes("__HIRAYA_")) throw new Error("The service worker build placeholders were not replaced.");
    },
  };
}
