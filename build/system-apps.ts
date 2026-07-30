import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import { parseManifestV2 } from "../packages/apps-contracts/src/index";

const PUBLIC_ID = "virtual:hiraya-system-apps";
const RESOLVED_ID = `\0${PUBLIC_ID}`;
export const SYSTEM_APP_SLUGS = ["text-editor", "markdown-preview", "image-viewer", "media-viewer", "file-viewer"] as const;

export function systemAppsPlugin(projectRoot: string): Plugin {
  let catalog = "";
  const archives = new Map<string, Uint8Array>();

  return {
    name: "hiraya-system-apps",
    enforce: "pre",
    async buildStart() {
      execFileSync("bun", ["run", "apps:system"], { cwd: projectRoot, stdio: "inherit" });
      const items = [];
      for (const slug of SYSTEM_APP_SLUGS) {
        const manifestPath = path.join(projectRoot, "apps", "system", slug, "public", "hiraya.app.json");
        const archivePath = path.join(projectRoot, "dist", "system-apps", `${slug}.hiraya.app`);
        const manifest = parseManifestV2(JSON.parse(await readFile(manifestPath, "utf8")));
        const archive = new Uint8Array(await readFile(archivePath));
        this.addWatchFile(manifestPath);
        archives.set(slug, archive);
        const digest = createHash("sha256").update(archive).digest("hex");
        items.push({ slug, archivePath: `system-apps/${slug}.hiraya.app`, digest, manifest });
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
        const prefix = `${base}system-apps/`;
        if (!pathname.startsWith(prefix)) { next(); return; }
        const fileName = pathname.slice(prefix.length);
        const match = /^([a-z0-9-]+)\.hiraya\.app$/.exec(fileName);
        const archive = match ? archives.get(match[1]) : undefined;
        if (!archive) { next(); return; }
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/zip");
        response.setHeader("Cache-Control", "no-store");
        response.end(archive);
      });
    },
    generateBundle() {
      for (const [slug, source] of archives) this.emitFile({ type: "asset", fileName: `system-apps/${slug}.hiraya.app`, source });
    },
  };
}
