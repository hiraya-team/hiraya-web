import { describe, expect, test } from "bun:test";
import { AuthenticationRequiredError, bootstrapSession, lockAuthBootstrap, loginUrl, parseAuthSession, safeReturnPath } from "../src/lib/auth";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe("session bootstrap", () => {
  test("validates stable storage identity and display metadata", () => {
    expect(parseAuthSession({ schemaVersion: 1, catalogId: "catalog-a", storageId: "opaque-account-1", user: { displayName: "Ada", email: "ada@example.test" }, capabilities: { blobTransfer: "direct-b2-v1" } })).toEqual({
      schemaVersion: 1,
      catalogId: "catalog-a",
      storageId: "opaque-account-1",
      user: { displayName: "Ada", email: "ada@example.test" },
      capabilities: { blobTransfer: "direct-b2-v1" },
    });
    const authority = { schemaVersion: 1, catalogId: "catalog-a" };
    expect(() => parseAuthSession({ ...authority, storageId: "", user: { displayName: "Ada" }, capabilities: { blobTransfer: "direct-b2-v1" } })).toThrow("storage ID");
    expect(() => parseAuthSession({ ...authority, storageId: "opaque-account-1", user: { displayName: "Ada" }, capabilities: { blobTransfer: "proxy-v1" } })).toThrow("direct-b2-v1");
    expect(parseAuthSession({ ...authority, storageId: "opaque-account-1", user: { displayName: "Ada" }, capabilities: { blobTransfer: "direct-b2-v1", desktopSearch: "accessible-desktops-v1" } }).capabilities.desktopSearch).toBe("accessible-desktops-v1");
    expect(() => parseAuthSession({ ...authority, storageId: "opaque-account-1", user: { displayName: "Ada" }, capabilities: { blobTransfer: "direct-b2-v1", desktopSearch: "legacy" } })).toThrow("desktop search");
    expect(() => parseAuthSession({ ...authority, schemaVersion: 2, storageId: "opaque-account-1", user: { displayName: "Ada" }, capabilities: { blobTransfer: "direct-b2-v1" } })).toThrow("Update Hiraya");
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

  test("uses a versioned validated bootstrap only when session fetch rejects", async () => {
    const storage = memoryStorage();
    const session = { schemaVersion: 1 as const, catalogId: "catalog-a", storageId: "account-a", user: { displayName: "Ada" }, capabilities: { blobTransfer: "direct-b2-v1" as const } };
    expect(await bootstrapSession(false, (async () => Response.json(session)) as typeof fetch, () => undefined, storage)).toEqual(session);
    expect(await bootstrapSession(false, (async () => { throw new TypeError("offline"); }) as typeof fetch, () => undefined, storage)).toEqual(session);
    await expect(bootstrapSession(false, (async () => new Response(null, { status: 401 })) as typeof fetch, () => undefined, storage)).rejects.toBeInstanceOf(AuthenticationRequiredError);
    await expect(bootstrapSession(false, (async () => { throw new TypeError("offline after logout"); }) as typeof fetch, () => undefined, storage)).rejects.toThrow("offline after logout");
    await expect(bootstrapSession(false, (async () => new Response(null, { status: 503 })) as typeof fetch, () => undefined, storage)).rejects.toThrow("503");
    await expect(bootstrapSession(false, (async () => Response.json({ ...session, storageId: "" })) as typeof fetch, () => undefined, storage)).rejects.toThrow("storage ID");
    const other = { ...session, storageId: "account-b", user: { displayName: "Grace" } };
    await bootstrapSession(false, (async () => Response.json(other)) as typeof fetch, () => undefined, storage);
    expect(await bootstrapSession(false, (async () => { throw new TypeError("offline"); }) as typeof fetch, () => undefined, storage)).toEqual(other);
  });

  test("locks cached account bootstrap synchronously on logout", async () => {
    const storage = memoryStorage();
    const session = { schemaVersion: 1 as const, catalogId: "catalog-a", storageId: "account-a", user: { displayName: "Ada" }, capabilities: { blobTransfer: "direct-b2-v1" as const } };
    await bootstrapSession(false, (async () => Response.json(session)) as typeof fetch, () => undefined, storage);
    lockAuthBootstrap(storage);
    await expect(bootstrapSession(false, (async () => { throw new TypeError("offline"); }) as typeof fetch, () => undefined, storage)).rejects.toThrow("offline");
  });

  test("an old cached shell cannot use bootstrap metadata without wire authority", async () => {
    const storage = memoryStorage();
    storage.setItem("hiraya-auth-bootstrap-v1", JSON.stringify({ version: 1, locked: false, session: { storageId: "account-a", user: { displayName: "Ada" }, capabilities: { blobTransfer: "direct-b2-v1" } } }));
    await expect(bootstrapSession(false, (async () => { throw new TypeError("offline"); }) as typeof fetch, () => undefined, storage)).rejects.toThrow("offline");
  });
});
