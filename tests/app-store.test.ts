import { afterEach, describe, expect, test } from "bun:test";
import { loadStorePackages } from "../src/lib/app-store";
import { sha256Blob } from "../src/lib/blob-transfer";
import { remoteDesktopIdentity, remoteDesktopState } from "./fixtures";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("app store content", () => {
  test("downloads and verifies the catalog through a direct descriptor", async () => {
    const content = new Blob([JSON.stringify({ schemaVersion: 1, releases: [] })]);
    const sha256 = await sha256Blob(content);
    const desktop = { ...remoteDesktopIdentity(), purpose: "app-store" as const };
    const state = { ...remoteDesktopState(), entries: [{ ...remoteDesktopState().entries[0], name: "hiraya.apps.json", size: content.size }] };
    let directInit: RequestInit | undefined;
    let directRequests = 0;
    let descriptorDigest = sha256;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("?projection=web")) return Response.json(state);
      if (String(input).startsWith("/api/")) return Response.json({ entryId: state.entries[0].id, contentRevision: state.entries[0].contentRevision, size: content.size, sha256: descriptorDigest, access: { url: "https://downloads.example.test/catalog", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 } });
      directInit = init;
      directRequests += 1;
      return new Response(content);
    }) as typeof fetch;

    await expect(Promise.all([
      loadStorePackages(desktop, "https://downloads.example.test"),
      loadStorePackages(desktop, "https://downloads.example.test"),
    ])).resolves.toEqual([
      expect.objectContaining({ managed: true, packages: [] }),
      expect.objectContaining({ managed: true, packages: [] }),
    ]);
    await expect(loadStorePackages(desktop, "https://downloads.example.test")).resolves.toMatchObject({ managed: true, packages: [] });
    expect(directRequests).toBe(1);
    expect(directInit).toMatchObject({ credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
    state.entries[0].contentRevision += 1;
    descriptorDigest = "0".repeat(64);
    await expect(loadStorePackages(desktop, "https://downloads.example.test")).rejects.toThrow("integrity verification");
    state.entries[0].contentRevision += 1;
    await expect(loadStorePackages(desktop, "https://objects.example.test")).rejects.toThrow("unexpected origin");
  });
});
