import { describe, expect, test } from "bun:test";
import { parseManifestV2 } from "@hiraya-team/apps-contracts";
import { catalogWithRelease } from "../build/release-app";

const manifest = parseManifestV2({ schemaVersion: 2, uiRuntime: 1, id: "dev.hiraya.notes", name: "Notes", version: "1.2.0", entrypoint: "index.html", permissions: [] });

describe("app release catalog", () => {
  test("activates one immutable release per app ID", () => {
    const first = catalogWithRelease({ schemaVersion: 1, releases: [] }, "store", "notes", "a".repeat(64), 123, manifest);
    expect(first.releases[0]?.fileName).toBe("notes-1.2.0-aaaaaaaaaaaa.hiraya.app");
    const updated = catalogWithRelease(first, "store", "notes", "b".repeat(64), 456, { ...manifest, version: "1.3.0" });
    expect(updated.releases).toHaveLength(1);
    expect(updated.releases[0]?.manifest.version).toBe("1.3.0");
    expect(() => catalogWithRelease(first, "store", "notes", "b".repeat(64), 123, manifest)).toThrow("different bytes");
    expect(() => catalogWithRelease(first, "system", "notes", "a".repeat(64), 123, manifest)).toThrow("not supported");
  });
});
