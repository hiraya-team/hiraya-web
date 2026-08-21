import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseManifestV2 } from "@hiraya-team/apps-contracts";
import { strToU8, zipSync } from "fflate";
import { SYSTEM_APP_SLUGS } from "../build/system-apps";
import { parseSystemAppDeploymentCatalog, verifyDeployedSystemApps } from "../build/verify-system-apps";

/** Builds the deployment fixture test fixture. */
async function deploymentFixture() {
  const archives = new Map<string, Uint8Array>();
  const apps = await Promise.all(SYSTEM_APP_SLUGS.map(async (slug) => {
    const manifest = parseManifestV2(JSON.parse(await readFile(join(import.meta.dir, "..", "apps", "system", slug, "public", "hiraya.app.json"), "utf8")));
    const archive = zipSync({ "hiraya.app.json": strToU8(JSON.stringify(manifest)), "index.html": strToU8("<main>System app</main>") });
    archives.set(slug, archive);
    return { slug, archivePath: `system-apps/${slug}.hiraya.app`, digest: createHash("sha256").update(archive).digest("hex"), size: archive.byteLength, manifest };
  }));
  return { catalog: { schemaVersion: 1, apps }, archives };
}

describe("bundled system app catalog", () => {
  test("contains six valid, unique trusted manifests and archive names", async () => {
    expect(SYSTEM_APP_SLUGS).toHaveLength(6);
    const manifests = await Promise.all(SYSTEM_APP_SLUGS.map(async (slug) => parseManifestV2(JSON.parse(await readFile(join(import.meta.dir, "..", "apps", "system", slug, "public", "hiraya.app.json"), "utf8")))));
    expect(new Set(manifests.map((manifest) => manifest.id)).size).toBe(6);
    expect(SYSTEM_APP_SLUGS.map((slug) => `system-apps/${slug}.hiraya.app`)).not.toContain("system-apps/folder-explorer.hiraya.app");
    expect(SYSTEM_APP_SLUGS.map((slug) => `system-apps/${slug}.hiraya.app`)).not.toContain("system-apps/markdown-preview.hiraya.app");
    expect(SYSTEM_APP_SLUGS.map((slug) => `system-apps/${slug}.hiraya.app`)).not.toContain("system-apps/scene-editor.hiraya.app");
  });

  test("emits trusted digests so ordinary startup does not inspect unchanged archives", async () => {
    const plugin = await Bun.file(new URL("../build/system-apps.ts", import.meta.url)).text();
    const launcher = await Bun.file(new URL("../src/features/app-management/launch.ts", import.meta.url)).text();

    expect(plugin).toContain('createHash("sha256")');
    expect(launcher).toContain('import("@hiraya-team/app-cli")');
    expect(launcher).toContain("install.appId === SYSTEM_APP_IDS.mediaViewer && isMarkdownFile(target)");
    expect(launcher).toContain("Only the bundled Document & Media Viewer can change this preference.");
    expect(launcher).toContain("Only the bundled Theme Editor can manage desktop themes.");
  });

  test("strictly parses the exact deployment catalog", async () => {
    const { catalog } = await deploymentFixture();
    expect(parseSystemAppDeploymentCatalog(catalog).apps.map((app) => app.slug)).toEqual(SYSTEM_APP_SLUGS);
    expect(() => parseSystemAppDeploymentCatalog({ ...catalog, apps: catalog.apps.slice(1) })).toThrow("exact bundled app set");
    expect(() => parseSystemAppDeploymentCatalog({ ...catalog, apps: catalog.apps.map((app, index) => index ? app : { ...app, archivePath: "system-apps/other.hiraya.app" }) })).toThrow("exact bundled app set");
    expect(() => parseSystemAppDeploymentCatalog({ ...catalog, apps: catalog.apps.map((app, index) => index ? app : { ...app, manifest: { ...app.manifest, id: "app.hiraya.other" } }) })).toThrow("app ID is invalid");
  });

  test("verifies every archive served by a deployment", async () => {
    const { catalog, archives } = await deploymentFixture();
    const server = Bun.serve({ port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/system-apps/catalog.json") return Response.json(catalog);
      const slug = /^\/system-apps\/([a-z0-9-]+)\.hiraya\.app$/.exec(path)?.[1];
      return slug && archives.has(slug) ? new Response(archives.get(slug)) : new Response(null, { status: 404 });
    } });
    try {
      expect((await verifyDeployedSystemApps(server.url.href)).map((app) => app.manifest.version)).toHaveLength(6);
      catalog.apps[0] = { ...catalog.apps[0]!, digest: "0".repeat(64) };
      await expect(verifyDeployedSystemApps(server.url.href)).rejects.toThrow("catalog digest");
    } finally {
      await server.stop(true);
    }
  });

  test("uses the shared loading surface in every bundled file app", async () => {
    await Promise.all(SYSTEM_APP_SLUGS.map(async (slug) => {
      const root = join(import.meta.dir, "..", "apps", "system", slug);
      const [html, source] = await Promise.all([
        readFile(join(root, "index.html"), "utf8"),
        readFile(join(root, "src", "main.ts"), "utf8"),
      ]);
      expect(html).toContain("<hiraya-loading-state");
      expect(html).toContain('aria-busy="true"');
      expect(source).toContain("setAppLoading");
    }));
  });
});
