import { afterEach, describe, expect, test } from "bun:test";
import { loadStorePackages } from "../src/lib/app-store";
import { sha256Blob } from "../src/lib/blob-transfer";
import { remoteDesktopIdentity, remoteDesktopState } from "./fixtures";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("app store content", () => {
  test("verifies raw same-origin catalog bytes before parsing", async () => {
    const content = new Blob([JSON.stringify({ schemaVersion: 1, releases: [] })]);
    const sha256 = await sha256Blob(content);
    const desktop = { ...remoteDesktopIdentity(), purpose: "app-store" as const };
    const state = { ...remoteDesktopState(), entries: [{ ...remoteDesktopState().entries[0], name: "hiraya.apps.json", size: content.size }] };
    const serve = (size: number, digest: string | null) => {
      globalThis.fetch = (async (input: RequestInfo | URL) => String(input).includes("?projection=web")
        ? Response.json({ ...state, entries: [{ ...state.entries[0], size }] })
        : new Response(content, { headers: { "content-type": "application/json", ...(digest === null ? {} : { "X-Hiraya-Content-SHA256": digest }) } })) as typeof fetch;
    };

    serve(content.size, sha256);
    await expect(loadStorePackages(desktop)).resolves.toMatchObject({ managed: true, packages: [] });
    serve(content.size + 1, sha256);
    await expect(loadStorePackages(desktop)).rejects.toThrow("integrity verification");
    serve(content.size, null);
    await expect(loadStorePackages(desktop)).rejects.toThrow();
    serve(content.size, "0".repeat(64));
    await expect(loadStorePackages(desktop)).rejects.toThrow("integrity verification");
  });
});
