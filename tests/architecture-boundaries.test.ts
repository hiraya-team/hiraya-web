import { describe, expect, test } from "bun:test";

describe("architecture migration boundaries", () => {
  test("sync storage declares an implementation-independent contract", async () => {
    const source = await Bun.file(new URL("../src/platform/sync/storage-port.ts", import.meta.url)).text();

    expect(source).toContain("export interface SyncStorage {");
    expect(source).not.toContain("Pick<typeof browserStorage");
  });

  test("persistence and theme parsers no longer re-export domain contracts", async () => {
    const opfs = await Bun.file(new URL("../src/lib/opfs.ts", import.meta.url)).text();
    const desktopState = await Bun.file(new URL("../src/lib/desktop-state.ts", import.meta.url)).text();
    const themes = await Bun.file(new URL("../src/lib/themes.ts", import.meta.url)).text();

    expect(opfs).not.toContain('export type { DesktopStateSnapshot }');
    expect(opfs).not.toContain('export type { LocalPreferences }');
    expect(desktopState).not.toContain('export type { DesktopSyncState');
    expect(themes).not.toContain('export type { CustomTheme');
  });
});
