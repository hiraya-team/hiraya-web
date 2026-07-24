import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseManifestV1 } from "@hiraya/apps-contracts";
import { SYSTEM_APP_SLUGS } from "../build/system-apps";

describe("bundled system app catalog", () => {
  test("contains six valid, unique trusted manifests and archive names", async () => {
    expect(SYSTEM_APP_SLUGS).toHaveLength(6);
    const manifests = await Promise.all(SYSTEM_APP_SLUGS.map(async (slug) => parseManifestV1(JSON.parse(await readFile(join(import.meta.dir, "..", "apps", "system", slug, "public", "hiraya.app.json"), "utf8")))));
    expect(new Set(manifests.map((manifest) => manifest.id)).size).toBe(6);
    expect(SYSTEM_APP_SLUGS.map((slug) => `system-apps/${slug}.hiraya.app`)).toContain("system-apps/folder-explorer.hiraya.app");
  });
});
