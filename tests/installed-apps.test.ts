import { describe, expect, test } from "bun:test";
import { installedAppAcceptsFile, installedAppIsAvailable, installedAppMatchesSavedIdentity, packageMatchesInstall, parseInstalledApp, type InstalledApp } from "../src/apps/installed-apps";
import { resolveFileApp } from "../src/apps/file-associations";

function install(version = "1.0.0", digest = "a".repeat(64), packageEntryId = "package-one"): InstalledApp {
  return { appId: "test.editor", source: "desktop", packageEntryId, archivePath: null, digest, version, approvedAt: 10, manifest: { schemaVersion: 1, id: "test.editor", name: "Editor", version, entrypoint: "index.html", permissions: ["files:read"] } };
}

describe("installed apps", () => {
  test("strictly validates approval identity", () => {
    expect(parseInstalledApp(install())).toEqual(install());
    expect(() => parseInstalledApp({ ...install(), appId: "test.other" })).toThrow("identity");
    expect(() => parseInstalledApp({ ...install(), extra: true })).toThrow("unsupported shape");
  });

  test("matches the complete approved package identity", () => {
    const first = install();
    expect(packageMatchesInstall(first, first.packageEntryId, first.digest, first.version)).toBe(true);
    expect(packageMatchesInstall(first, first.packageEntryId, "b".repeat(64), first.version)).toBe(false);
    const updated = { ...install("2.0.0", "b".repeat(64), "package-two"), manifest: { ...install("2.0.0", "b".repeat(64), "package-two").manifest, fileTypes: [".txt"] } };
    const apps = [updated];
    const associations = [{ matcher: ".txt", appId: first.appId, createdAt: 1 }];
    expect(apps).toEqual([updated]);
    expect(resolveFileApp({ name: "notes.txt", mimeType: "text/plain" }, apps, [{ id: updated.packageEntryId, kind: "file" }], associations)?.app).toEqual(updated);
  });

  test("trusts updated bundled identities but not updated desktop packages", () => {
    const desktop = install();
    const system = parseInstalledApp({ ...desktop, source: "system", packageEntryId: null, archivePath: "system-apps/text-editor.hiraya.app" });
    const changed = { appId: desktop.appId, source: desktop.source, digest: "b".repeat(64), permissions: ["files:read", "theme"] } as const;
    expect(installedAppMatchesSavedIdentity(system, { ...changed, source: "system" })).toBe(true);
    expect(installedAppMatchesSavedIdentity(desktop, changed)).toBe(false);
    expect(installedAppMatchesSavedIdentity(desktop, { appId: desktop.appId })).toBe(true);
  });

  test("reports deleted and wrong-kind package entries as unavailable", () => {
    const app = install();
    expect(installedAppIsAvailable(app, [])).toBe(false);
    expect(installedAppIsAvailable(app, [{ id: app.packageEntryId, kind: "folder" }])).toBe(false);
    expect(installedAppIsAvailable(app, [{ id: app.packageEntryId, kind: "file" }])).toBe(true);
  });

  test("matches declared MIME, wildcard, and extension associations", () => {
    const app = install();
    const associated = { ...app, manifest: { ...app.manifest, fileTypes: ["text/plain", "image/*", ".md"] } };
    expect(installedAppAcceptsFile(associated, { name: "notes.txt", mimeType: "text/plain; charset=utf-8" })).toBe(true);
    expect(installedAppAcceptsFile(associated, { name: "photo.bin", mimeType: "image/png" })).toBe(true);
    expect(installedAppAcceptsFile(associated, { name: "README.MD", mimeType: "application/octet-stream" })).toBe(true);
    expect(installedAppAcceptsFile(associated, { name: "archive.zip", mimeType: "application/zip" })).toBe(false);
  });

  test("keeps bundled system apps available without a desktop package", () => {
    const system = parseInstalledApp({ ...install(), source: "system", packageEntryId: null, archivePath: "system-apps/text-editor.hiraya.app" });
    expect(installedAppIsAvailable(system, [])).toBe(true);
  });
});
