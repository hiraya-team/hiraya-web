import { describe, expect, test } from "bun:test";
import { AuthenticationRequiredError, bootstrapSession, lockAuthBootstrap, loginUrl, parseAuthSession, readCachedSession, safeReturnPath } from "../src/lib/auth";

const userId = "10000000-0000-4000-8000-000000000001";
const accountId = "20000000-0000-4000-8000-000000000002";
const storageId = "30000000-0000-4000-8000-000000000003";
const workspaceId = "40000000-0000-4000-8000-000000000004";

function wireSession(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    protocol: "web2-sync-v1",
    user: { id: userId, email: "ada@example.test", displayName: "Ada", deploymentAdmin: true },
    accounts: [{ id: accountId, name: "Ada", storageId, quota: { storageBytes: { used: 0, limit: 1024 }, workspaces: { used: 1, limit: 8 }, nodes: { used: 0, limit: 1000 } }, workspaces: [{ id: workspaceId, name: "Desktop", pinned: true, role: "owner" }] }],
    directoryRevision: 7,
    directBlobOrigin: "https://objects.test",
    buildTimestamp: "2026-08-18T00:00:00Z",
    ...overrides,
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe("session bootstrap", () => {
  test("strictly selects a server-issued account and storage namespace", () => {
    expect(parseAuthSession(wireSession())).toMatchObject({ schemaVersion: 1, apiProtocol: "web2-sync-v1", accountId, catalogId: accountId, storageId, directBlobOrigin: "https://objects.test", user: { id: userId, displayName: "Ada", deploymentAdmin: true }, account: { id: accountId } });
    expect(() => parseAuthSession({ ...wireSession(), protocol: "entry-transactions-v2" })).toThrow("protocol");
    expect(() => parseAuthSession({ ...wireSession(), storageId })).toThrow("unsupported shape");
    expect(() => parseAuthSession({ ...wireSession(), directBlobOrigin: null })).toThrow("direct chunk storage");
    expect(() => parseAuthSession({ ...wireSession(), accounts: [] })).toThrow("accessible account workspace");
  });

  test("keeps login returns root-relative", () => {
    expect(safeReturnPath({ pathname: "/desktops/desk/areas/0/0", search: "?open=Notes", hash: "#details" } as Location)).toBe("/desktops/desk/areas/0/0?open=Notes#details");
    expect(safeReturnPath({ pathname: "//example.test", search: "", hash: "" } as Location)).toBe("/");
    expect(loginUrl({ pathname: "/desktops/desk/areas/0/0", search: "", hash: "#details" } as Location)).toBe("/login?returnTo=%2Fdesktops%2Fdesk%2Fareas%2F0%2F0%23details");
  });

  test("does not fetch in frontend-only mode", async () => {
    let fetched = false;
    expect(await bootstrapSession(true, (async () => { fetched = true; throw new Error("unexpected"); }) as typeof fetch)).toBeNull();
    expect(fetched).toBe(false);
  });

  test("redirects a 401 through the centralized handler", async () => {
    let redirects = 0;
    await expect(bootstrapSession(false, (async () => new Response(null, { status: 401 })) as typeof fetch, () => { redirects += 1; })).rejects.toBeInstanceOf(AuthenticationRequiredError);
    expect(redirects).toBe(1);
  });

  test("uses only a validated Web2 cache after a network failure", async () => {
    const storage = memoryStorage();
    const parsed = await bootstrapSession(false, (async () => Response.json(wireSession())) as typeof fetch, () => undefined, storage);
    expect(parsed?.storageId).toBe(storageId);
    expect(readCachedSession(storage)?.accountId).toBe(accountId);
    expect((await bootstrapSession(false, (async () => { throw new TypeError("offline"); }) as typeof fetch, () => undefined, storage))?.accountId).toBe(accountId);
    lockAuthBootstrap(storage);
    expect(readCachedSession(storage)).toBeNull();
    await expect(bootstrapSession(false, (async () => { throw new TypeError("offline"); }) as typeof fetch, () => undefined, storage)).rejects.toThrow("network is unavailable");
  });

  test("rejects the retired bootstrap cache", async () => {
    const storage = memoryStorage();
    storage.setItem("hiraya-auth-bootstrap-v1", JSON.stringify({ version: 1, locked: false, session: { storageId: "account-a" } }));
    await expect(bootstrapSession(false, (async () => { throw new TypeError("offline"); }) as typeof fetch, () => undefined, storage)).rejects.toThrow("network is unavailable");
  });
});
