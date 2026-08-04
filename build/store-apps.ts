import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import { parseManifestV2 } from "../packages/apps-contracts/src/index";

const PUBLIC_ID = "virtual:hiraya-store-apps";
const RESOLVED_ID = `\0${PUBLIC_ID}`;
export const STORE_APPS = [
  { slug: "calculator", directory: "calculator-app" },
  { slug: "zip-browser", directory: "zip-browser-app" },
  { slug: "pixel-editor", directory: "pixel-editor-app" },
  { slug: "project-studio", directory: "project-studio-app" },
  { slug: "hiraya-pos", directory: "pos-inventory-app" },
  { slug: "todo", directory: "todo-app" },
] as const;

export function storeAppsPlugin(projectRoot: string): Plugin {
  let catalog = "";
  const archives = new Map<string, Uint8Array>();

  return {
    name: "hiraya-store-apps",
    enforce: "pre",
    async buildStart() {
      execFileSync("bun", ["run", "apps:store"], { cwd: projectRoot, stdio: "inherit" });
      const items = [];
      for (const item of STORE_APPS) {
        const manifestPath = path.join(projectRoot, "examples", item.directory, "public", "hiraya.app.json");
        const archivePath = path.join(projectRoot, "dist", "app-store", `${item.slug}.hiraya.app`);
        const manifest = parseManifestV2(JSON.parse(await readFile(manifestPath, "utf8")));
        const archive = new Uint8Array(await readFile(archivePath));
        const digest = createHash("sha256").update(archive).digest("hex");
        this.addWatchFile(manifestPath);
        archives.set(item.slug, archive);
        items.push({ slug: item.slug, archivePath: `app-store/${item.slug}.hiraya.app`, digest, size: archive.byteLength, contentRevision: Number.parseInt(digest.slice(0, 12), 16), manifest });
      }
      catalog = `export default ${JSON.stringify(items)};`;
    },
    resolveId(id) {
      return id === PUBLIC_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id === RESOLVED_ID) return catalog;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://vite.invalid").pathname;
        const base = server.config.base.endsWith("/") ? server.config.base : `${server.config.base}/`;
        const prefix = `${base}app-store/`;
        if (!pathname.startsWith(prefix)) { next(); return; }
        const match = /^([a-z0-9-]+)\.hiraya\.app$/.exec(pathname.slice(prefix.length));
        const archive = match ? archives.get(match[1]) : undefined;
        if (!archive) { next(); return; }
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/zip");
        response.setHeader("Cache-Control", "no-store");
        response.end(archive);
      });
    },
    generateBundle() {
      for (const [slug, source] of archives) this.emitFile({ type: "asset", fileName: `app-store/${slug}.hiraya.app`, source });
    },
  };
}
