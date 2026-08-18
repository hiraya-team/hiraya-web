import { describe, expect, test } from "bun:test";
import { isStandalone, pwaInstallState, updateActivationBlocked, type InstallPromptEvent } from "../src/lib/pwa-install";

describe("PWA installation state", () => {
  test("requests the protected manifest with same-origin credentials", async () => {
    const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('crossorigin="use-credentials"');
  });

  test("prioritizes standalone and installed status over prompt guidance", () => {
    const prompt = {} as InstallPromptEvent;
    expect(pwaInstallState(prompt, false, true)).toBe("standalone");
    expect(pwaInstallState(prompt, true, false)).toBe("installed");
    expect(pwaInstallState(prompt, false, false)).toBe("promptable");
    expect(pwaInstallState(null, false, false)).toBe("guidance");
    expect(isStandalone(true, false)).toBe(true);
    expect(isStandalone(false, true)).toBe(true);
  });

  test("blocks update activation while any app has dirty work", async () => {
    const idle = { query: async () => ({ held: [], pending: [] }) } as unknown as LockManager;
    const active = { query: async () => ({ held: [{ name: "hiraya-workspace-commit", mode: "exclusive", clientId: "client" }], pending: [] }) } as unknown as LockManager;
    const pending = { query: async () => ({ held: [], pending: [{ name: "hiraya-app-install", mode: "exclusive", clientId: "client" }] }) } as unknown as LockManager;
    expect(await updateActivationBlocked([false, true], idle)).toBe(true);
    expect(await updateActivationBlocked([false, false], active)).toBe(true);
    expect(await updateActivationBlocked([false, false], pending)).toBe(true);
    expect(await updateActivationBlocked([false, false], idle)).toBe(false);
  });
});
