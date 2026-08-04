import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseManifestV2 } from "@hiraya-team/apps-contracts";
import { STORE_APPS } from "../build/store-apps";

describe("Hiraya App Store catalog", () => {
  test("contains the six valid first-party app packages", async () => {
    expect(STORE_APPS).toHaveLength(6);
    expect(STORE_APPS.map(({ slug }) => slug)).toContain("todo");
    const manifests = await Promise.all(STORE_APPS.map(async ({ directory }) => parseManifestV2(JSON.parse(await readFile(join(import.meta.dir, "..", "examples", directory, "public", "hiraya.app.json"), "utf8")))));
    expect(new Set(manifests.map(({ id }) => id)).size).toBe(STORE_APPS.length);
  });
});
