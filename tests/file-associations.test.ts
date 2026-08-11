import { describe, expect, test } from "bun:test";
import { associationCandidates, matchingInstalledApps, reservedFileHandler, resolveFileApp, resolveRestoredFileApp, systemDefaultAppId } from "../src/apps/file-associations";
import type { InstalledApp } from "../src/apps/installed-apps";
import { SYSTEM_APP_IDS } from "../src/apps/system-app-ids";
import { APP_SHORTCUT_MIME_TYPE } from "../src/lib/app-shortcut";

function app(appId: string, fileTypes: string[]): InstalledApp {
  return { appId, source: "system", packageEntryId: null, archivePath: `system-apps/${appId.split(".").at(-1)}.hiraya.app`, digest: "a".repeat(64), version: "1.0.0", approvedAt: 1, manifest: { schemaVersion: 2, uiRuntime: 1, id: appId, name: appId, version: "1.0.0", entrypoint: "index.html", permissions: ["files:read"], fileTypes } };
}

describe("file association resolution", () => {
  const media = app(SYSTEM_APP_IDS.mediaViewer, [".md", ".markdown", "text/markdown", "application/pdf", "audio/*", "video/*"]);
  const text = app(SYSTEM_APP_IDS.textEditor, ["text/*", ".hiraya.scene", "application/vnd.hiraya.scene+zip"]);
  const generic = app(SYSTEM_APP_IDS.fileViewer, ["application/*", "text/*"]);
  const terminal = app(SYSTEM_APP_IDS.terminal, [".hsh", "text/x-hiraya-shell"]);

  test("orders longest compound extension before exact and wildcard MIME", () => {
    expect(associationCandidates({ name: "notes.test.md", mimeType: "text/markdown; charset=utf-8" })).toEqual([".test.md", ".md", "text/markdown", "text/*"]);
  });

  test("uses only compatible extension, exact MIME, wildcard MIME, then system defaults", () => {
    const file = { name: "notes.md", mimeType: "text/markdown" };
    expect(resolveFileApp(file, [media, text, generic], [], [{ matcher: ".md", appId: text.appId, createdAt: 1 }])?.app.appId).toBe(text.appId);
    expect(resolveFileApp(file, [media, text, generic], [], [{ matcher: "text/markdown", appId: generic.appId, createdAt: 1 }])?.app.appId).toBe(generic.appId);
    expect(resolveFileApp(file, [media, text, generic], [], [{ matcher: "text/*", appId: text.appId, createdAt: 1 }])?.app.appId).toBe(text.appId);
    expect(resolveFileApp(file, [media, text, generic], [], [])?.app.appId).toBe(text.appId);
    expect(systemDefaultAppId({ name: "README.markdown", mimeType: "application/octet-stream" })).toBe(media.appId);
  });

  test("retains an unavailable preference and safely falls back", () => {
    const resolution = resolveFileApp({ name: "notes.txt", mimeType: "text/plain" }, [text, generic], [], [{ matcher: ".txt", appId: "missing.editor", createdAt: 1 }]);
    expect(resolution?.app.appId).toBe(text.appId);
    expect(resolution?.preferredUnavailable).toEqual({ appId: "missing.editor", matcher: ".txt" });
  });

  test("silently advances system handlers while strictly validating user handlers", () => {
    const file = { name: "notes.txt", mimeType: "text/plain" };
    const user = { ...text, appId: "user.notes", source: "desktop" as const, packageEntryId: "package", archivePath: null, digest: "b".repeat(64), manifest: { ...text.manifest, id: "user.notes" } };
    const entries = [{ id: "package", kind: "file" as const }];
    expect(resolveRestoredFileApp(file, [text, generic], [], [], { appId: text.appId, source: text.source, digest: text.digest, permissions: text.manifest.permissions })?.app.appId).toBe(text.appId);
    expect(resolveRestoredFileApp(file, [text, user, generic], entries, [{ matcher: "text/plain", appId: user.appId, createdAt: 1 }], { appId: user.appId, source: user.source, digest: user.digest, permissions: user.manifest.permissions })?.app.appId).toBe(user.appId);
    const fallback = resolveRestoredFileApp(file, [text, generic], [], [{ matcher: ".txt", appId: "missing.editor", createdAt: 1 }], { appId: "missing.editor", source: "desktop", digest: "c".repeat(64), permissions: ["files:read"] });
    expect(fallback?.app.appId).toBe(text.appId);
    expect(fallback?.preferredUnavailable?.appId).toBe("missing.editor");
    expect(resolveRestoredFileApp(file, [text, generic], [], [], { appId: text.appId, source: text.source, digest: "d".repeat(64), permissions: ["files:read", "theme"] })?.app).toBe(text);
    expect(resolveRestoredFileApp(file, [text, user, generic], entries, [{ matcher: "text/plain", appId: user.appId, createdAt: 1 }], { appId: user.appId, source: user.source, digest: "d".repeat(64), permissions: user.manifest.permissions })).toBeNull();
  });

  test("reserves app packages and shortcuts ahead of user mappings", () => {
    const apps = [text, generic];
    for (const file of [{ name: "editor.hiraya.app", mimeType: "application/zip" }, { name: "Integrated Editor", mimeType: APP_SHORTCUT_MIME_TYPE }, { name: "website.URL", mimeType: "text/plain" }]) {
      expect(reservedFileHandler(file)).not.toBeNull();
      expect(resolveFileApp(file, apps, [], [{ matcher: file.name.endsWith("app") ? ".app" : file.name.endsWith("URL") ? ".url" : APP_SHORTCUT_MIME_TYPE, appId: text.appId, createdAt: 1 }])).toBeNull();
      expect(matchingInstalledApps(apps, [], file)).toEqual([]);
    }
  });

  test("routes application documents to the document viewer without overriding text MIME", () => {
    for (const file of [
      { name: "report.bin", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document; charset=binary" },
      { name: "report.DOCX", mimeType: "application/octet-stream" },
      { name: "notes.RTF", mimeType: "application/octet-stream" },
    ]) expect(systemDefaultAppId(file)).toBe(SYSTEM_APP_IDS.mediaViewer);
    expect(systemDefaultAppId({ name: "notes.RTF", mimeType: "TEXT/RTF; charset=windows-1252" })).toBe(SYSTEM_APP_IDS.textEditor);
    expect(systemDefaultAppId({ name: "legacy.doc", mimeType: "application/msword" })).toBe(SYSTEM_APP_IDS.fileViewer);
  });

  test("uses Terminal as an extension fallback without overriding text MIME", () => {
    const fallback = { name: "build.HSH", mimeType: "application/octet-stream" };
    expect(reservedFileHandler(fallback)).toBeNull();
    expect(systemDefaultAppId(fallback)).toBe(SYSTEM_APP_IDS.terminal);
    expect(resolveFileApp(fallback, [terminal, text, generic], [], [])?.app.appId).toBe(SYSTEM_APP_IDS.terminal);
    for (const file of [{ name: "build.HSH", mimeType: "text/plain" }, { name: "build.txt", mimeType: "text/x-hiraya-shell" }]) {
      expect(systemDefaultAppId(file)).toBe(SYSTEM_APP_IDS.textEditor);
      expect(resolveFileApp(file, [terminal, text, generic], [], [])?.app.appId).toBe(SYSTEM_APP_IDS.textEditor);
    }
  });

  test("opens Scene packages in Integrated Editor", () => {
    const file = { name: "ambient.HIRAYA.SCENE", mimeType: "application/vnd.hiraya.scene+zip" };
    expect(systemDefaultAppId(file)).toBe(SYSTEM_APP_IDS.textEditor);
    expect(resolveFileApp(file, [text, generic], [], [])?.app.appId).toBe(SYSTEM_APP_IDS.textEditor);
  });
});
