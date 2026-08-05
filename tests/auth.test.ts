import { describe, expect, test } from "bun:test";
import { AuthenticationRequiredError, bootstrapSession, lockAuthBootstrap, loginUrl, parseAuthSession, safeReturnPath } from "../src/lib/auth";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe("session bootstrap", () => {
  test("validates stable storage identity and display metadata", () => {
    const directBlobOrigin = "https://objects.test";
    expect(parseAuthSession({ schemaVersion: 2, apiProtocol: "entry-transactions-v2", catalogId: "catalog-a", storageId: "opaque-account-1", directBlobOrigin, user: { displayName: "Ada", email: "ada@example.test" }, capabilities: { entryTransactions: "prepare-commit-cancel-v1" } })).toEqual({
      schemaVersion: 2,
      apiProtocol: "entry-transactions-v2",
      catalogId: "catalog-a",
      storageId: "opaque-account-1",
      directBlobOrigin,
      user: { displayName: "Ada", email: "ada@example.test" },
      capabilities: { entryTransactions: "prepare-commit-cancel-v1" },
    });
    const authority = { schemaVersion: 2, apiProtocol: "entry-transactions-v2", catalogId: "catalog-a" };
    const supported = { entryTransactions: "prepare-commit-cancel-v1" };
    expect(() => parseAuthSession({ ...authority, apiProtocol: "legacy", storageId: "opaque-account-1", directBlobOrigin, user: { displayName: "Ada" }, capabilities: supported })).toThrow("entry transaction protocol");
    expect(() => parseAuthSession({ ...authority, storageId: "opaque-account-1", directBlobOrigin, user: { displayName: "Ada" }, capabilities: {} })).toThrow("entry transaction protocol");
    expect(() => parseAuthSession({ ...authority, storageId: "", directBlobOrigin, user: { displayName: "Ada" }, capabilities: supported })).toThrow("storage ID");
    expect(parseAuthSession({ ...authority, storageId: "opaque-account-1", directBlobOrigin, user: { displayName: "Ada" }, capabilities: { ...supported, desktopSearch: "accessible-desktops-v1" } }).capabilities.desktopSearch).toBe("accessible-desktops-v1");
    expect(() => parseAuthSession({ ...authority, storageId: "opaque-account-1", directBlobOrigin, user: { displayName: "Ada" }, capabilities: { ...supported, desktopSearch: "legacy" } })).toThrow("desktop search");
    expect(() => parseAuthSession({ ...authority, schemaVersion: 1, storageId: "opaque-account-1", user: { displayName: "Ada" }, capabilities: supported })).toThrow("Update Hiraya");
    expect(parseAuthSession({ ...authority, storageId: "opaque-account-1", directBlobOrigin, user: { displayName: "Ada" }, capabilities: { ...supported, shortLinks: "account-short-links-v1" }, shortLinkBaseUrl: "/r" })).toMatchObject({ capabilities: { shortLinks: "account-short-links-v1" }, shortLinkBaseUrl: "/r" });
    expect(parseAuthSession({ ...authority, storageId: "opaque-account-1", directBlobOrigin, user: { displayName: "Ada" }, capabilities: { ...supported, shortLinks: "account-short-links-v1" }, shortLinkBaseUrl: "https://go.hiraya.sh" }).shortLinkBaseUrl).toBe("https://go.hiraya.sh");
    expect(parseAuthSession({ ...authority, storageId: "opaque-account-1", directBlobOrigin, user: { displayName: "Ada" }, capabilities: { ...supported, shortLinks: "account-short-links-v1" }, shortLinkBaseUrl: "http://127.0.0.1:8080/r" }).shortLinkBaseUrl).toBe("http://127.0.0.1:8080/r");
    expect(parseAuthSession({ ...authority, storageId: "opaque-account-1", directBlobOrigin, user: { displayName: "Ada" }, capabilities: { ...supported, publications: "alias-publications-v1" }, publicationBaseUrl: "https://go.hiraya.sh" })).toMatchObject({ capabilities: { publications: "alias-publications-v1" }, publicationBaseUrl: "https://go.hiraya.sh" });
    expect(() => parseAuthSession({ ...authority, storageId: "opaque-account-1", directBlobOrigin, user: { displayName: "Ada" }, capabilities: { ...supported, publications: "legacy" }, publicationBaseUrl: "https://go.hiraya.sh" })).toThrow("publication capability");
    expect(() => parseAuthSession({ ...authority, storageId: "opaque-account-1", directBlobOrigin, user: { displayName: "Ada" }, capabilities: { ...supported, publications: "alias-publications-v1" } })).toThrow("incomplete publication");
    expect(() => parseAuthSession({ ...authority, storageId: "opaque-account-1", directBlobOrigin, user: { displayName: "Ada" }, capabilities: supported, publicationBaseUrl: "https://go.hiraya.sh" })).toThrow("incomplete publication");
    expect(() => parseAuthSession({ ...authority, storageId: "opaque-account-1", directBlobOrigin, user: { displayName: "Ada" }, capabilities: { ...supported, shortLinks: "legacy" }, shortLinkBaseUrl: "/r" })).toThrow("short-link capability");
    expect(() => parseAuthSession({ ...authority, storageId: "opaque-account-1", directBlobOrigin, user: { displayName: "Ada" }, capabilities: { ...supported, shortLinks: "account-short-links-v1" } })).toThrow("incomplete short-link");
    for (const shortLinkBaseUrl of ["r", "//example.test/r", "/r?from=session", "/r#links", "/\\example.test/r", "https:example.test/r", "https://user:secret@example.test/r", "https://example.test/r?from=session", "https://example.test/r#links", "https://example.test\\@evil.test/r", "ftp://example.test/r"]) {
      expect(() => parseAuthSession({ ...authority, storageId: "opaque-account-1", directBlobOrigin, user: { displayName: "Ada" }, capabilities: { ...supported, shortLinks: "account-short-links-v1" }, shortLinkBaseUrl })).toThrow("short-link base URL");
    }
    for (const invalidOrigin of ["http://objects.test", "https://objects.test/path", "https://user:secret@objects.test", "https://objects.test?query", "data:text/plain,test"]) {
      expect(() => parseAuthSession({ ...authority, storageId: "opaque-account-1", directBlobOrigin: invalidOrigin, user: { displayName: "Ada" }, capabilities: supported })).toThrow("direct blob origin");
    }
    expect(parseAuthSession({ ...authority, storageId: "opaque-account-1", directBlobOrigin: "HTTPS://OBJECTS.TEST:443", user: { displayName: "Ada" }, capabilities: supported }).directBlobOrigin).toBe("https://objects.test");
    for (const loopbackOrigin of ["http://localhost:9000", "http://127.0.0.1:9000", "http://[::1]:9000"]) {
      expect(parseAuthSession({ ...authority, storageId: "opaque-account-1", directBlobOrigin: loopbackOrigin, user: { displayName: "Ada" }, capabilities: supported }).directBlobOrigin).toBe(loopbackOrigin);
    }
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
    const session = { schemaVersion: 2 as const, apiProtocol: "entry-transactions-v2" as const, catalogId: "catalog-a", storageId: "account-a", directBlobOrigin: "https://objects.test", user: { displayName: "Ada" }, capabilities: { entryTransactions: "prepare-commit-cancel-v1" as const } };
    let bootstrapRequest: RequestInit | undefined;
    expect(await bootstrapSession(false, (async (_input, init) => { bootstrapRequest = init; return Response.json(session); }) as typeof fetch, () => undefined, storage)).toEqual(session);
    expect(new Headers(bootstrapRequest?.headers).get("X-Hiraya-Protocol")).toBe("entry-transactions-v2");
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
    const session = { schemaVersion: 2 as const, apiProtocol: "entry-transactions-v2" as const, catalogId: "catalog-a", storageId: "account-a", directBlobOrigin: "https://objects.test", user: { displayName: "Ada" }, capabilities: { entryTransactions: "prepare-commit-cancel-v1" as const } };
    await bootstrapSession(false, (async () => Response.json(session)) as typeof fetch, () => undefined, storage);
    lockAuthBootstrap(storage);
    await expect(bootstrapSession(false, (async () => { throw new TypeError("offline"); }) as typeof fetch, () => undefined, storage)).rejects.toThrow("offline");
  });

  test("an old cached shell cannot use bootstrap metadata without wire authority", async () => {
    const storage = memoryStorage();
    storage.setItem("hiraya-auth-bootstrap-v1", JSON.stringify({ version: 1, locked: false, session: { storageId: "account-a", user: { displayName: "Ada" }, capabilities: {} } }));
    await expect(bootstrapSession(false, (async () => { throw new TypeError("offline"); }) as typeof fetch, () => undefined, storage)).rejects.toThrow("offline");
  });
});
