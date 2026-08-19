import { afterEach, describe, expect, test } from "bun:test";
import { WEB2_SCHEMA_VERSION, canonicalManifestSha256, sha256Hex } from "../src/filesystem/model";
import { WEB2_SYNC_PROTOCOL, parseAccountEventHint, parseInvitationList, parsePublicationState, parsePublicNodeContent, parsePublicWeb2ThumbnailDescriptor, parsePublicWorkspacePage, parseSharingState, parseShortLinkList, parseWeb2AccountAppData, parseWeb2AccountAppPackage, parseWeb2AccountAppsSnapshot, parseWeb2ActivityResponse, parseWeb2EventHint, parseWeb2SearchResponse, parseWeb2Session, parseWeb2ThumbnailDescriptor, parseWorkspaceInvitationList, parseWorkspaceInvitationRequest, type ChunkTransferDescriptor, type PushRequest } from "../src/sync/protocol";
import { clearWeb2AccountAppData, createWeb2InvitationToken, createWeb2Workspace, deleteWeb2AccountApp, deleteWeb2AccountAppData, deleteWeb2Invitation, deleteWeb2NodePublication, deleteWeb2Publication, deleteWeb2SharingAudience, deleteWeb2SharingMember, deleteWeb2ShortLink, deleteWeb2Workspace, deleteWeb2WorkspaceInvitation, downloadWeb2Chunk, fetchPublicNodeContent, fetchPublicWeb2Thumbnail, fetchPublicWorkspacePage, fetchWeb2AccountApps, fetchWeb2Activity, fetchWeb2Invitations, fetchWeb2Publication, fetchWeb2Session, fetchWeb2Sharing, fetchWeb2ShortLinks, fetchWeb2Thumbnail, fetchWeb2WorkspaceInvitations, listenForWeb2Events, pushWeb2, putWeb2AccountApp, putWeb2AccountAppData, putWeb2AccountAppHandlers, putWeb2Invitation, putWeb2NodePublication, putWeb2Publication, putWeb2SharingAudience, putWeb2SharingMember, putWeb2ShortLink, putWeb2WorkspaceInvitation, renameWeb2Workspace, searchWeb2, setWeb2WorkspacePreferences, updateWeb2SharingMember, uploadWeb2Chunk, web2ProtocolMetadata } from "../src/sync/transport";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

const sessionValue = {
  schemaVersion: WEB2_SCHEMA_VERSION,
  protocol: WEB2_SYNC_PROTOCOL,
  user: { id: id("1"), email: "admin@example.com", displayName: "Administrator", deploymentAdmin: true },
  accounts: [{ id: id("2"), name: "Account", storageId: id("3"), quota: { storageBytes: { used: 0, limit: 100_000_000 }, workspaces: { used: 1, limit: 10 }, nodes: { used: 0, limit: 5000 } }, workspaces: [{ id: id("4"), name: "Desktop", pinned: false, role: "owner" }] }],
  directoryRevision: 1,
  directBlobOrigin: "https://objects.example",
  buildTimestamp: "2026-08-17T00:00:00Z",
};

describe("Web2 transport", () => {
  test("validates the account-scoped session before startup", async () => {
    let requestInput: RequestInfo | URL | undefined;
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestInput = input;
      requestInit = init;
      return Response.json(sessionValue);
    }) as typeof fetch;

    expect(parseWeb2Session(sessionValue).accounts[0]?.storageId).toBe(id("3"));
    expect((await fetchWeb2Session()).accounts[0]?.workspaces[0]?.id).toBe(id("4"));
    expect(String(requestInput)).toBe("/api/auth/session");
    expect(requestInit?.credentials).toBe("same-origin");
    expect(requestInit?.cache).toBe("no-store");

    const aliased = structuredClone(sessionValue);
    aliased.accounts.push({ id: id("7"), name: "Second", storageId: id("3"), quota: sessionValue.accounts[0]!.quota, workspaces: [{ id: id("8"), name: "Second Desktop", pinned: false, role: "owner" }] });
    expect(() => parseWeb2Session(aliased)).toThrow("inconsistent");
    expect(parseWeb2Session({ ...sessionValue, accounts: [] }).accounts).toEqual([]);
    expect(parseWeb2Session({ ...sessionValue, user: { ...sessionValue.user, displayName: "A/B" } }).user.displayName).toBe("A/B");
    expect(parseWeb2Session({ ...sessionValue, accounts: [{ ...sessionValue.accounts[0]!, quota: null, workspaces: [{ ...sessionValue.accounts[0]!.workspaces[0]!, role: "reader" }] }] }).accounts[0]?.quota).toBeNull();
    expect(() => parseWeb2Session({ ...sessionValue, accounts: [{ ...sessionValue.accounts[0]!, quota: { ...sessionValue.accounts[0]!.quota, nodes: { used: -1, limit: 1 } } }] })).toThrow("usage is invalid");
    expect(() => parseWeb2Session({ ...sessionValue, accounts: [{ ...sessionValue.accounts[0]!, quota: null }] })).toThrow("ownership");
    expect(() => parseWeb2Session({ ...sessionValue, accounts: [{ ...sessionValue.accounts[0]!, quota: sessionValue.accounts[0]!.quota, workspaces: [{ ...sessionValue.accounts[0]!.workspaces[0]!, role: "reader" }] }] })).toThrow("ownership");
    expect(() => parseWeb2Session({ ...sessionValue, accounts: [{ ...sessionValue.accounts[0]!, workspaces: [sessionValue.accounts[0]!.workspaces[0]!, { id: id("9"), name: "Shared", pinned: false, role: "reader" }] }] })).toThrow("ownership");
  });

  test("binds ordered push receipts to the request", async () => {
    const workspaceId = id("4");
    const deviceId = id("5");
    const operationId = id("6");
    const request: PushRequest = {
      schemaVersion: WEB2_SCHEMA_VERSION,
      protocol: WEB2_SYNC_PROTOCOL,
      workspaceId,
      deviceId,
      operations: [{ schemaVersion: WEB2_SCHEMA_VERSION, kind: "set", operationId, workspaceId, deviceId, logicalTime: 1, namespace: "desktop-grid", key: "grid-size", value: 24 }],
    };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`/api/workspaces/${workspaceId}/sync/push`);
      expect(new Headers(init?.headers).get("X-Hiraya-Protocol")).toBe(WEB2_SYNC_PROTOCOL);
      expect(JSON.parse(String(init?.body))).toEqual(request);
      return Response.json({
        schemaVersion: WEB2_SCHEMA_VERSION,
        protocol: WEB2_SYNC_PROTOCOL,
        results: [{ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "accepted", workspaceId, operationId, sequence: 1, headSequence: 1, outcome: "applied" }],
      });
    }) as typeof fetch;

    expect((await pushWeb2(request)).results[0]?.operationId).toBe(operationId);
  });

  test("sends strict workspace control requests", async () => {
    const accountId = id("2");
    const workspaceId = id("4");
    const operationIds = [id("10"), id("11"), id("12"), id("13")];
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(null, { status: init?.method === "POST" ? 201 : 204, headers: init?.method === "POST" ? { Location: `/api/workspaces/${workspaceId}` } : undefined });
    }) as typeof fetch;

    await createWeb2Workspace(accountId, operationIds[0]!, { ...web2ProtocolMetadata, id: workspaceId, name: "Workspace" });
    await renameWeb2Workspace(workspaceId, operationIds[1]!, { ...web2ProtocolMetadata, name: "Renamed" });
    await setWeb2WorkspacePreferences(accountId, operationIds[2]!, { ...web2ProtocolMetadata, workspaces: [{ id: workspaceId, pinned: true }] });
    await deleteWeb2Workspace(workspaceId, operationIds[3]!);

    expect(calls.map(({ input, init }) => [String(input), init?.method])).toEqual([
      [`/api/accounts/${accountId}/workspaces`, "POST"],
      [`/api/workspaces/${workspaceId}`, "PATCH"],
      [`/api/accounts/${accountId}/workspace-preferences`, "PUT"],
      [`/api/workspaces/${workspaceId}`, "DELETE"],
    ]);
    expect(calls.every(({ init }) => init?.credentials === "same-origin" && init.cache === "no-store" && new Headers(init.headers).get("X-Hiraya-Protocol") === WEB2_SYNC_PROTOCOL)).toBe(true);
    expect(calls.map(({ init }) => new Headers(init?.headers).get("X-Hiraya-Operation-ID"))).toEqual(operationIds);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ ...web2ProtocolMetadata, id: workspaceId, name: "Workspace" });
    expect(calls[3]?.init?.body).toBeUndefined();
  });

  test("rejects the wrong workspace control success status", async () => {
    globalThis.fetch = (async () => new Response(null, { status: 202 })) as typeof fetch;
    await expect(deleteWeb2Workspace(id("4"), id("10"))).rejects.toMatchObject({ status: 202 });
  });

  test("preserves workspace quota errors", async () => {
    globalThis.fetch = (async () => Response.json({ error: "account workspace quota exceeded", code: "quota_exceeded" }, { status: 409 })) as typeof fetch;
    await expect(createWeb2Workspace(id("2"), id("10"), { ...web2ProtocolMetadata, id: id("4"), name: "Workspace" })).rejects.toMatchObject({ status: 409, code: "quota_exceeded", message: "account workspace quota exceeded" });
  });

  test("rejects unsupported read success statuses and bounded error bodies", async () => {
    globalThis.fetch = (async () => Response.json(sessionValue, { status: 201 })) as typeof fetch;
    await expect(fetchWeb2Session()).rejects.toMatchObject({ status: 201 });
    globalThis.fetch = (async () => new Response("x".repeat(64 * 1024 + 1), { status: 503 })) as typeof fetch;
    await expect(fetchWeb2Session()).rejects.toMatchObject({ status: 503, message: "Synchronization request failed with status 503." });
    globalThis.fetch = (async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error("truncated")); } }), { status: 503 })) as typeof fetch;
    await expect(fetchWeb2Session()).rejects.toMatchObject({ status: 503 });
  });

  test("validates and sends sharing controls", async () => {
    const workspaceId = id("4");
    const memberId = id("5");
    const state = {
      ...web2ProtocolMetadata,
      workspaceId,
      members: [
        { userId: id("1"), email: "owner@example.com", displayName: "Owner", role: "owner" },
        { userId: memberId, email: "member@example.com", displayName: "Member", role: "writer" },
      ],
      audience: { kind: "authenticated-users", role: "reader" },
    } as const;
    expect(parseSharingState(state)).toEqual(state);
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return init?.method === undefined ? Response.json(state) : new Response(null, { status: 204 });
    }) as typeof fetch;
    const operations = [id("20"), id("21"), id("22"), id("23"), id("24")];

    expect(await fetchWeb2Sharing(workspaceId)).toEqual(state);
    await putWeb2SharingMember(workspaceId, operations[0]!, { ...web2ProtocolMetadata, email: " MEMBER@example.com ", role: "writer" });
    await updateWeb2SharingMember(workspaceId, memberId, operations[1]!, { ...web2ProtocolMetadata, role: "reader" });
    await deleteWeb2SharingMember(workspaceId, memberId, operations[2]!);
    await putWeb2SharingAudience(workspaceId, operations[3]!, { ...web2ProtocolMetadata, role: "reader" });
    await deleteWeb2SharingAudience(workspaceId, operations[4]!);

    expect(calls.map(({ input, init }) => [String(input), init?.method ?? "GET"])).toEqual([
      [`/api/workspaces/${workspaceId}/sharing`, "GET"],
      [`/api/workspaces/${workspaceId}/sharing/members`, "PUT"],
      [`/api/workspaces/${workspaceId}/sharing/members/${memberId}`, "PUT"],
      [`/api/workspaces/${workspaceId}/sharing/members/${memberId}`, "DELETE"],
      [`/api/workspaces/${workspaceId}/sharing/audience`, "PUT"],
      [`/api/workspaces/${workspaceId}/sharing/audience`, "DELETE"],
    ]);
    expect(JSON.parse(String(calls[1]?.init?.body)).email).toBe("member@example.com");
    expect(calls.slice(1).map(({ init }) => new Headers(init?.headers).get("X-Hiraya-Operation-ID"))).toEqual(operations);
  });

  test("validates search and durable activity reads", async () => {
    const workspaceId = id("4");
    const operationId = id("6");
    const tuple = { logicalTime: 1, operationId };
    const node = { workspaceId, id: id("5"), kind: "folder", name: "Quarterly Report", parentId: null, lifecycle: { kind: "active" }, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1, fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: null } };
    const search = { ...web2ProtocolMetadata, query: "Report", limit: 10, truncated: false, results: [{ accountId: id("2"), workspaceId, workspaceName: "Desktop", node, breadcrumbs: [] }] };
    const activity = { ...web2ProtocolMetadata, activities: [{ id: 1, accountId: id("2"), workspaceId, workspaceName: "Desktop", sequence: 1, operationId, kind: "create", timestamp: 1_800_000_000_000, actor: sessionValue.user, nodeIds: [node.id] }], nextBefore: null };
    expect(parseWeb2SearchResponse(search, "Report").results[0]?.node.id).toBe(node.id);
    expect(parseWeb2ActivityResponse(activity).activities[0]?.operationId).toBe(operationId);
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json(String(input).startsWith("/api/search") ? search : activity);
    }) as typeof fetch;

    expect((await searchWeb2("Report", 10)).results[0]?.node.id).toBe(node.id);
    expect((await fetchWeb2Activity({ workspaceId, limit: 10 })).activities[0]?.kind).toBe("create");
    expect(calls).toEqual([`/api/search?q=Report&limit=10`, `/api/activity?limit=10&workspaceId=${workspaceId}`]);
  });

  test("validates and sends publication controls", async () => {
    const workspaceId = id("4");
    const nodeId = id("5");
    const state = { ...web2ProtocolMetadata, workspaceId, alias: "public-workspace", url: "/published/public-workspace", shareEntire: true, items: [{ nodeId, name: "Folder", kind: "folder", alias: "folder", url: "/published/public-workspace/folder" }] } as const;
    expect(parsePublicationState(state)).toEqual(state);
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return init?.method === undefined ? Response.json(state) : new Response(null, { status: 204 });
    }) as typeof fetch;
    const operations = [id("30"), id("31"), id("32"), id("33")];

    expect((await fetchWeb2Publication(workspaceId)).items[0]?.nodeId).toBe(nodeId);
    await putWeb2Publication(workspaceId, operations[0]!, { ...web2ProtocolMetadata, alias: "public-workspace", shareEntire: true });
    await putWeb2NodePublication(workspaceId, nodeId, operations[1]!, { ...web2ProtocolMetadata, alias: "folder" });
    await deleteWeb2NodePublication(workspaceId, nodeId, operations[2]!);
    await deleteWeb2Publication(workspaceId, operations[3]!);

    expect(calls.map(({ input, init }) => [String(input), init?.method ?? "GET"])).toEqual([
      [`/api/workspaces/${workspaceId}/publication`, "GET"],
      [`/api/workspaces/${workspaceId}/publication`, "PUT"],
      [`/api/workspaces/${workspaceId}/publication/nodes/${nodeId}`, "PUT"],
      [`/api/workspaces/${workspaceId}/publication/nodes/${nodeId}`, "DELETE"],
      [`/api/workspaces/${workspaceId}/publication`, "DELETE"],
    ]);
    expect(calls.slice(1).map(({ init }) => new Headers(init?.headers).get("X-Hiraya-Operation-ID"))).toEqual(operations);
  });

  test("validates anonymous publication pages and content", async () => {
    const workspaceId = id("4");
    const nodeId = id("5");
    const operationId = id("6");
    const tuple = { logicalTime: 1, operationId };
    const node = { workspaceId, id: nodeId, kind: "folder", name: "Folder", parentId: null, lifecycle: { kind: "active" }, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1, fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: null } };
    const page = { ...web2ProtocolMetadata, workspaceAlias: "public-workspace", itemAlias: "folder", workspaceId, workspaceName: "Desktop", publishedRootId: nodeId, asOf: 1, owner: { id: id("1"), displayName: "Owner", avatar: "identicon:0123456789abcdef" }, nodes: [node], settings: [], nextAfter: null };
    const manifest = { schemaVersion: WEB2_SCHEMA_VERSION, size: 0, chunkSize: 1024 * 1024, chunks: [] } as const;
    const content = { ...web2ProtocolMetadata, workspaceAlias: "public-workspace", itemAlias: "folder", nodeId, asOf: 1, manifestHash: await canonicalManifestSha256(manifest), manifest, chunks: [] };
    expect(parsePublicWorkspacePage(page).publishedRootId).toBe(nodeId);
    const publicSetting = { workspaceId, namespace: "wallpaper", key: "layout", deleted: false, value: { source: "dusk" }, logicalTime: 1, operationId: id("7") };
    expect(parsePublicWorkspacePage({ ...page, itemAlias: null, publishedRootId: null, settings: [publicSetting] }).settings).toEqual([publicSetting]);
    expect(() => parsePublicWorkspacePage({ ...page, settings: [publicSetting] })).toThrow("focused settings");
    expect(() => parsePublicWorkspacePage({ ...page, itemAlias: null, publishedRootId: null, settings: [{ ...publicSetting, namespace: "editor" }] })).toThrow("focused settings");
    expect(() => parsePublicWorkspacePage({ ...page, itemAlias: null, publishedRootId: null, settings: [{ ...publicSetting, deleted: true, value: undefined }] })).toThrow();
    expect((await parsePublicNodeContent(content)).manifest.size).toBe(0);
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return Response.json(String(input).includes("/content?") ? content : page);
    }) as typeof fetch;

    expect((await fetchPublicWorkspacePage("public-workspace", { itemAlias: "folder", limit: 10 })).nodes[0]?.id).toBe(nodeId);
    await expect(fetchPublicWorkspacePage("public-workspace", { itemAlias: "folder", asOf: 2 })).rejects.toThrow("does not match");
    expect((await fetchPublicNodeContent("public-workspace", nodeId, content.manifestHash, 1, "folder")).manifestHash).toBe(content.manifestHash);
    expect(calls.map(({ init }) => init?.credentials)).toEqual(["omit", "omit", "same-origin"]);
  });

  test("validates pending, authenticated, and public Web2 thumbnails", async () => {
    const workspaceId = id("4");
    const nodeId = id("5");
    const contentOperationId = id("6");
    const manifestHash = "a".repeat(64);
    const descriptor = { ...web2ProtocolMetadata, kind: "thumbnail", workspaceId, nodeId, contentOperationId, manifestHash, profile: "thumbnail-v1", mimeType: "image/webp", width: 320, height: 180, size: 12, sha256: "b".repeat(64), access: { url: "https://objects.example.test/thumbnail", method: "GET", headers: {}, expiresAt: 1_800_000_000_000 } } as const;
    const publicDescriptor = { ...descriptor, workspaceAlias: "public-workspace", itemAlias: "folder", asOf: 1 };
    expect(parseWeb2ThumbnailDescriptor(descriptor, { workspaceId, nodeId, contentOperationId, manifestHash }, "https://objects.example.test").width).toBe(320);
    expect(parsePublicWeb2ThumbnailDescriptor(publicDescriptor, { workspaceAlias: "public-workspace", itemAlias: "folder", workspaceId, nodeId, contentOperationId, manifestHash, asOf: 1 }).height).toBe(180);
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (calls.length === 1) return Response.json({ ...web2ProtocolMetadata, kind: "thumbnail", workspaceId, nodeId, state: "pending" }, { status: 202, headers: { "Retry-After": "2" } });
      return Response.json(String(input).startsWith("/api/public/") ? publicDescriptor : descriptor);
    }) as typeof fetch;

    const pending = await fetchWeb2Thumbnail(workspaceId, nodeId, contentOperationId, manifestHash, "https://objects.example.test");
    expect(pending).toMatchObject({ state: "pending", retryAfterMs: 2000 });
    const ready = await fetchWeb2Thumbnail(workspaceId, nodeId, contentOperationId, manifestHash, "https://objects.example.test");
    expect(ready.state === "ready" && ready.value.sha256).toBe("b".repeat(64));
    const publicReady = await fetchPublicWeb2Thumbnail("public-workspace", nodeId, contentOperationId, manifestHash, 1, "folder");
    expect(publicReady.state === "ready" && publicReady.value.workspaceAlias).toBe("public-workspace");
    expect(calls.map(({ init }) => init?.credentials)).toEqual(["same-origin", "same-origin", "omit"]);
    expect(String(calls[2]?.input)).toContain("contentOperationId=");
    expect(String(calls[2]?.input)).toContain("asOf=1");

    globalThis.fetch = (async () => Response.json({ ...web2ProtocolMetadata, kind: "thumbnail", workspaceId, nodeId, state: "pending" }, { status: 202 })) as typeof fetch;
    expect(await fetchWeb2Thumbnail(workspaceId, nodeId, contentOperationId, manifestHash, "https://objects.example.test")).toMatchObject({ state: "pending", retryAfterMs: 250 });
  });

  test("validates account app inventory, controls, and events", async () => {
    const accountId = id("2");
    const appId = "dev.hiraya.notes";
    const manifest = { schemaVersion: 2 as const, uiRuntime: 1 as const, id: appId, name: "Notes", version: "1.0.0", entrypoint: "index.html", permissions: ["storage" as const] };
    const app = { appId, manifest, generations: { installationGeneration: 1, dataGeneration: 0, itemRevision: 1 }, package: { manifestHash: "a".repeat(64), size: 100, sha256: "b".repeat(64) }, data: [{ key: "state/editor", dataGeneration: 0, revision: 2, size: 4, sha256: "c".repeat(64) }] };
    const snapshot = { ...web2ProtocolMetadata, accountId, appsRevision: 2, handlerHints: { ".txt": appId }, apps: [app], tombstones: [] };
    expect(parseWeb2AccountAppsSnapshot(snapshot).apps[0]?.appId).toBe(appId);
    expect(parseWeb2EventHint({ ...web2ProtocolMetadata, kind: "account-apps", accountId, appsRevision: 2 })).toMatchObject({ kind: "account-apps", appsRevision: 2 });
    const chunk = new TextEncoder().encode("data");
    const chunkHash = await sha256Hex(chunk);
    const packageManifest = { schemaVersion: WEB2_SCHEMA_VERSION, size: chunk.byteLength, chunkSize: 1024 * 1024, chunks: [{ hash: chunkHash, size: chunk.byteLength }] } as const;
    const packageManifestHash = await canonicalManifestSha256(packageManifest);
    const parsedPackage = await parseWeb2AccountAppPackage({ ...web2ProtocolMetadata, accountId, appId, appManifest: manifest, manifestHash: packageManifestHash, size: chunk.byteLength, sha256: chunkHash, manifest: packageManifest, chunks: [{ hash: chunkHash, size: chunk.byteLength, method: "GET", url: "https://objects.example/chunk", headers: {} }] }, "https://objects.example");
    expect(parsedPackage.chunks[0]?.hash).toBe(chunkHash);
    const dataBytes = new TextEncoder().encode(`{"x":1}`);
    expect((await parseWeb2AccountAppData({ ...web2ProtocolMetadata, accountId, appId, key: "state", dataGeneration: 0, revision: 2, size: dataBytes.byteLength, sha256: await sha256Hex(dataBytes), valueJson: `{"x":1}` })).value).toEqual({ x: 1 });
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return init?.method === undefined ? Response.json(snapshot) : new Response(null, { status: 204 });
    }) as typeof fetch;
    const operations = [id("60"), id("61"), id("62"), id("63"), id("64"), id("65")];
    expect((await fetchWeb2AccountApps(accountId)).apps[0]?.package.sha256).toBe("b".repeat(64));
    await putWeb2AccountApp(accountId, appId, operations[0]!, { ...web2ProtocolMetadata, manifest, packageManifestHash: app.package.manifestHash, packageSize: app.package.size, packageSha256: app.package.sha256, installationGeneration: 0, itemRevision: 0 });
    await putWeb2AccountAppHandlers(accountId, operations[1]!, { ".txt": appId });
    await putWeb2AccountAppData(accountId, appId, "state/editor", operations[2]!, { ...web2ProtocolMetadata, dataGeneration: 0, value: { draft: true } });
    await deleteWeb2AccountAppData(accountId, appId, "state/editor", operations[3]!, 0);
    await clearWeb2AccountAppData(accountId, appId, operations[4]!, 0);
    await deleteWeb2AccountApp(accountId, appId, operations[5]!, 1);
    expect(calls.map(({ input, init }) => [String(input), init?.method ?? "GET"])).toEqual([
      [`/api/accounts/${accountId}/apps`, "GET"],
      [`/api/accounts/${accountId}/apps/${appId}`, "PUT"],
      [`/api/accounts/${accountId}/apps/handlers`, "PUT"],
      [`/api/accounts/${accountId}/apps/${appId}/data/state%2Feditor`, "PUT"],
      [`/api/accounts/${accountId}/apps/${appId}/data/state%2Feditor`, "DELETE"],
      [`/api/accounts/${accountId}/apps/${appId}/data`, "DELETE"],
      [`/api/accounts/${accountId}/apps/${appId}`, "DELETE"],
    ]);
    expect(calls.slice(1).map(({ init }) => new Headers(init?.headers).get("X-Hiraya-Operation-ID"))).toEqual(operations);
    globalThis.fetch = (async () => Response.json({ error: "stale", code: "generation_conflict" }, { status: 409 })) as typeof fetch;
    await expect(deleteWeb2AccountApp(accountId, appId, id("66"), 1)).rejects.toMatchObject({ status: 409, code: "generation_conflict" });
  });

  test("validates and sends account short-link controls", async () => {
    const accountId = id("2");
    const list = { ...web2ProtocolMetadata, accountId, shortLinks: [{ slug: "docs", url: "/r/docs", destinationUrl: "https://example.com/docs", enabled: true, createdAt: 1, updatedAt: 1 }] };
    expect(parseShortLinkList(list).shortLinks[0]?.slug).toBe("docs");
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return init?.method === undefined ? Response.json(list) : new Response(null, { status: 204 });
    }) as typeof fetch;
    const putOperationId = id("40");
    const deleteOperationId = id("41");

    expect((await fetchWeb2ShortLinks(accountId)).shortLinks[0]?.destinationUrl).toBe("https://example.com/docs");
    await putWeb2ShortLink(accountId, putOperationId, { ...web2ProtocolMetadata, slug: "docs", destinationUrl: "https://example.com/docs", enabled: true });
    await deleteWeb2ShortLink(accountId, "docs", deleteOperationId);
    expect(calls.map(({ input, init }) => [String(input), init?.method ?? "GET"])).toEqual([
      [`/api/accounts/${accountId}/short-links`, "GET"],
      [`/api/accounts/${accountId}/short-links/docs`, "PUT"],
      [`/api/accounts/${accountId}/short-links/docs`, "DELETE"],
    ]);
  });

  test("generates and sends administrator invitations without listing tokens", async () => {
    const invitationId = id("50");
    const token = createWeb2InvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const list = { ...web2ProtocolMetadata, invitations: [{ id: invitationId, email: "new@example.com", expiresAt: 1_800_003_600, createdAt: 1_800_000_000 }] };
    expect(parseInvitationList(list).invitations[0]?.id).toBe(invitationId);
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return init?.method === undefined ? Response.json(list) : new Response(null, { status: 204 });
    }) as typeof fetch;
    const putOperationId = id("51");
    const deleteOperationId = id("52");

    expect((await fetchWeb2Invitations()).invitations[0]?.email).toBe("new@example.com");
    await putWeb2Invitation(putOperationId, { ...web2ProtocolMetadata, id: invitationId, token, email: "new@example.com", expiresAt: 1_800_003_600 });
    await deleteWeb2Invitation(invitationId, deleteOperationId);
    expect(calls.map(({ input, init }) => [String(input), init?.method ?? "GET"])).toEqual([
      ["/api/admin/invitations", "GET"],
      [`/api/admin/invitations/${invitationId}`, "PUT"],
      [`/api/admin/invitations/${invitationId}`, "DELETE"],
    ]);
  });

  test("sends workspace invitations through the shared token contract", async () => {
    const workspaceId = id("4");
    const invitationId = id("60");
    const token = createWeb2InvitationToken();
    const list = { ...web2ProtocolMetadata, workspaceId, invitations: [{ id: invitationId, email: "shared@example.com", role: "writer", createdAt: 1_800_000_000 }] };
    expect(parseWorkspaceInvitationList(list).invitations[0]?.role).toBe("writer");
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return init?.method === undefined ? Response.json(list) : new Response(null, { status: 204 });
    }) as typeof fetch;
    const putOperationId = id("61");
    const deleteOperationId = id("62");

    expect((await fetchWeb2WorkspaceInvitations(workspaceId)).invitations[0]?.email).toBe("shared@example.com");
    const request = { ...web2ProtocolMetadata, id: invitationId, token, email: "shared@example.com", role: "writer" } as const;
    await putWeb2WorkspaceInvitation(workspaceId, putOperationId, request);
    await deleteWeb2WorkspaceInvitation(workspaceId, invitationId, deleteOperationId);
    expect(calls.map(({ input, init }) => [String(input), init?.method ?? "GET"])).toEqual([
      [`/api/workspaces/${workspaceId}/sharing/invitations`, "GET"],
      [`/api/workspaces/${workspaceId}/sharing/invitations/${invitationId}`, "PUT"],
      [`/api/workspaces/${workspaceId}/sharing/invitations/${invitationId}`, "DELETE"],
    ]);
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual(request);
    expect(() => parseWorkspaceInvitationRequest({ ...request, expiresAt: 1_800_003_600 })).toThrow("unsupported shape");
    expect(() => parseWorkspaceInvitationRequest({ ...request, email: "not-an-email" })).toThrow("email is invalid");
    expect(() => parseWorkspaceInvitationList({ ...list, invitations: [{ ...list.invitations[0]!, email: " SHARED@example.com " }] })).toThrow("email is invalid");
    expect(() => parseWorkspaceInvitationList({ ...list, invitations: [list.invitations[0]!, { ...list.invitations[0]!, id: id("63") }] })).toThrow("duplicate IDs or emails");
  });

  test("omits credentials and verifies direct chunk bytes", async () => {
    const bytes = new TextEncoder().encode("hello");
    const hash = await sha256Hex(bytes);
    const upload: ChunkTransferDescriptor<"PUT"> = { hash, size: bytes.length, method: "PUT", url: "https://objects.example/upload", headers: { "x-amz-checksum-sha256": "checksum" } };
    const download: ChunkTransferDescriptor<"GET"> = { hash, size: bytes.length, method: "GET", url: "https://objects.example/download", headers: {} };
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return String(input).endsWith("/download") ? new Response(bytes) : new Response(null, { status: 200 });
    }) as typeof fetch;

    await uploadWeb2Chunk(upload, bytes);
    expect(new TextDecoder().decode(await downloadWeb2Chunk(download))).toBe("hello");
    expect(calls.map(({ init }) => init?.credentials)).toEqual(["omit", "omit"]);
    expect(new Headers(calls[0]?.init?.headers).get("x-amz-checksum-sha256")).toBe("checksum");
  });

  test("parses account event hints from the fetch stream", async () => {
    const event = { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "workspace-head", accountId: id("2"), workspaceId: id("4"), headSequence: 7 } as const;
    expect(parseAccountEventHint(event)).toEqual(event);
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: workspace-head\ndata: ${JSON.stringify(event)}\n\n`));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;
    const controller = new AbortController();
    let received;
    await listenForWeb2Events(controller.signal, (value) => {
      received = value;
      controller.abort();
    });
    expect(received).toEqual(event);
  });

  test("parses directed directory event hints", async () => {
    const event = { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "directory", revision: 7 } as const;
    expect(parseWeb2EventHint(event)).toEqual(event);
    let requested = "";
    globalThis.fetch = (async (input) => {
      requested = String(input);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`event: directory\ndata: ${JSON.stringify(event)}\n\n`));
          controller.close();
        },
      }), { headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;
    const controller = new AbortController();
    let received;
    await listenForWeb2Events(controller.signal, (value) => {
      received = value;
      controller.abort();
    }, 6);
    expect(requested).toContain("directoryRevision=6");
    expect(received).toEqual(event);
  });

  test("reports heartbeat and event stream activity", async () => {
    const event = { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "workspace-head", accountId: id("2"), workspaceId: id("4"), headSequence: 7 } as const;
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`: heartbeat\n\nevent: workspace-head\ndata: ${JSON.stringify(event)}\n\n`));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;
    const controller = new AbortController();
    let activity = 0;
    await listenForWeb2Events(controller.signal, () => controller.abort(), 0, () => { activity++; });
    expect(activity).toBe(2);
  });

  test("accepts many bounded SSE frames delivered in one read", async () => {
    const events = Array.from({ length: 600 }, (_, index) => ({ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "workspace-head", accountId: id("2"), workspaceId: id("4"), headSequence: index + 1 } as const));
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } })) as typeof fetch;
    const controller = new AbortController();
    let received = 0;
    await listenForWeb2Events(controller.signal, () => {
      received++;
      if (received === events.length) controller.abort();
    });
    expect(received).toBe(events.length);
  });

  test("stops buffered SSE dispatch immediately after abort", async () => {
    const events = [1, 2].map((headSequence) => ({ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "workspace-head", accountId: id("2"), workspaceId: id("4"), headSequence } as const));
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;
    const controller = new AbortController();
    let received = 0;
    await listenForWeb2Events(controller.signal, () => {
      received++;
      controller.abort();
    });
    expect(received).toBe(1);
  });

  test("rejects JSON lookalike media types", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify(sessionValue), { headers: { "Content-Type": "application/jsonp" } })) as typeof fetch;
    await expect(fetchWeb2Session()).rejects.toThrow("not JSON");
  });
});
