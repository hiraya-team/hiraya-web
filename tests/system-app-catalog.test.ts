import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseManifestV2 } from "@hiraya-team/apps-contracts";
import { SYSTEM_APP_SLUGS } from "../build/system-apps";

describe("bundled system app catalog", () => {
  test("contains six valid, unique trusted manifests and archive names", async () => {
    expect(SYSTEM_APP_SLUGS).toHaveLength(6);
    const manifests = await Promise.all(SYSTEM_APP_SLUGS.map(async (slug) => parseManifestV2(JSON.parse(await readFile(join(import.meta.dir, "..", "apps", "system", slug, "public", "hiraya.app.json"), "utf8")))));
    expect(new Set(manifests.map((manifest) => manifest.id)).size).toBe(6);
    expect(SYSTEM_APP_SLUGS.map((slug) => `system-apps/${slug}.hiraya.app`)).not.toContain("system-apps/folder-explorer.hiraya.app");
    expect(SYSTEM_APP_SLUGS.map((slug) => `system-apps/${slug}.hiraya.app`)).not.toContain("system-apps/markdown-preview.hiraya.app");
  });

  test("emits trusted digests so ordinary startup does not inspect unchanged archives", async () => {
    const plugin = await Bun.file(new URL("../build/system-apps.ts", import.meta.url)).text();
    const controller = await Bun.file(new URL("../src/features/app-management/controller.ts", import.meta.url)).text();
    const launcher = await Bun.file(new URL("../src/features/app-management/launch.ts", import.meta.url)).text();

    expect(plugin).toContain('createHash("sha256")');
    expect(controller).not.toContain('import("@hiraya-team/app-cli")');
    expect(controller).not.toContain("systemAppArchiveUrl");
    expect(controller).toContain('current?.source === "system" && systemInstallMatchesCatalog(current, item)');
    expect(controller.indexOf("await installApp(install)")).toBeLessThan(controller.indexOf("await retireMarkdownPreview()"));
    expect(controller.indexOf("await retireMarkdownPreview()")).toBeLessThan(controller.indexOf("await releaseApprovedPackageArchive(retiredDigest)"));
    expect(launcher).toContain('import("@hiraya-team/app-cli")');
    expect(launcher).toContain("install.appId === SYSTEM_APP_IDS.mediaViewer && isMarkdownFile(target)");
    expect(launcher).toContain("Only the bundled Document & Media Viewer can change this preference.");
    expect(launcher).toContain("Only the bundled Theme Editor can manage desktop themes.");
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
