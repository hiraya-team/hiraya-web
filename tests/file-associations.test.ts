import { describe, expect, test } from "bun:test";
import { associationCandidates, matchingInstalledApps, reservedFileHandler, resolveFileApp, resolveRestoredFileApp } from "../src/apps/file-associations";
import type { InstalledApp } from "../src/apps/installed-apps";
import { SYSTEM_APP_IDS } from "../src/apps/system-app-ids";

function app(appId: string, fileTypes: string[]): InstalledApp {
  return { appId, source: "system", packageEntryId: null, archivePath: `system-apps/${appId.split(".").at(-1)}.hiraya.app`, digest: "a".repeat(64), version: "1.0.0", approvedAt: 1, manifest: { schemaVersion: 1, id: appId, name: appId, version: "1.0.0", entrypoint: "index.html", permissions: ["files:read"], fileTypes } };
}

describe("file association resolution", () => {
  const markdown = app(SYSTEM_APP_IDS.markdownPreview, [".md", "text/markdown"]);
  const text = app(SYSTEM_APP_IDS.textEditor, ["text/*"]);
  const generic = app(SYSTEM_APP_IDS.fileViewer, ["application/*", "text/*"]);

  test("orders longest compound extension before exact and wildcard MIME", () => {
    expect(associationCandidates({ name: "notes.test.md", mimeType: "text/markdown; charset=utf-8" })).toEqual([".test.md", ".md", "text/markdown", "text/*"]);
  });

  test("uses only compatible extension, exact MIME, wildcard MIME, then system defaults", () => {
    const file = { name: "notes.md", mimeType: "text/markdown" };
    expect(resolveFileApp(file, [markdown, text, generic], [], [{ matcher: ".md", appId: text.appId, createdAt: 1 }])?.app.appId).toBe(markdown.appId);
    expect(resolveFileApp(file, [markdown, text, generic], [], [{ matcher: "text/markdown", appId: generic.appId, createdAt: 1 }])?.app.appId).toBe(generic.appId);
    expect(resolveFileApp(file, [markdown, text, generic], [], [{ matcher: "text/*", appId: text.appId, createdAt: 1 }])?.app.appId).toBe(text.appId);
    expect(resolveFileApp(file, [markdown, text, generic], [], [])?.app.appId).toBe(markdown.appId);
  });

  test("retains an unavailable preference and safely falls back", () => {
    const resolution = resolveFileApp({ name: "notes.txt", mimeType: "text/plain" }, [text, generic], [], [{ matcher: ".txt", appId: "missing.editor", createdAt: 1 }]);
    expect(resolution?.app.appId).toBe(text.appId);
    expect(resolution?.preferredUnavailable).toEqual({ appId: "missing.editor", matcher: ".txt" });
  });

  test("restores validated preferred system and user handlers and visibly falls back when unavailable", () => {
    const file = { name: "notes.txt", mimeType: "text/plain" };
    const user = { ...text, appId: "user.notes", source: "desktop" as const, packageEntryId: "package", archivePath: null, digest: "b".repeat(64), manifest: { ...text.manifest, id: "user.notes" } };
    const entries = [{ id: "package", kind: "file" as const }];
    expect(resolveRestoredFileApp(file, [text, generic], [], [], { appId: text.appId, source: text.source, digest: text.digest, permissions: text.manifest.permissions })?.app.appId).toBe(text.appId);
    expect(resolveRestoredFileApp(file, [text, user, generic], entries, [{ matcher: "text/plain", appId: user.appId, createdAt: 1 }], { appId: user.appId, source: user.source, digest: user.digest, permissions: user.manifest.permissions })?.app.appId).toBe(user.appId);
    const fallback = resolveRestoredFileApp(file, [text, generic], [], [{ matcher: ".txt", appId: "missing.editor", createdAt: 1 }], { appId: "missing.editor", source: "desktop", digest: "c".repeat(64), permissions: ["files:read"] });
    expect(fallback?.app.appId).toBe(text.appId);
    expect(fallback?.preferredUnavailable?.appId).toBe("missing.editor");
    expect(resolveRestoredFileApp(file, [text, generic], [], [], { appId: text.appId, source: text.source, digest: "d".repeat(64), permissions: text.manifest.permissions })).toBeNull();
  });

  test("reserves app packages and internet shortcuts ahead of user mappings", () => {
    const apps = [text, generic];
    for (const file of [{ name: "editor.hiraya.app", mimeType: "application/zip" }, { name: "website.URL", mimeType: "text/plain" }]) {
      expect(reservedFileHandler(file)).not.toBeNull();
      expect(resolveFileApp(file, apps, [], [{ matcher: file.name.endsWith("app") ? ".app" : ".url", appId: text.appId, createdAt: 1 }])).toBeNull();
      expect(matchingInstalledApps(apps, [], file)).toEqual([]);
    }
  });
});
