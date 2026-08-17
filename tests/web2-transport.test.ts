import { afterEach, describe, expect, test } from "bun:test";
import { WEB2_SCHEMA_VERSION, sha256Hex } from "../src/filesystem/model";
import { WEB2_SYNC_PROTOCOL, parseAccountEventHint, parseWeb2Session, type ChunkTransferDescriptor, type PushRequest } from "../src/sync/protocol";
import { downloadWeb2Chunk, fetchWeb2Session, listenForWeb2Events, pushWeb2, uploadWeb2Chunk } from "../src/sync/transport";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

const sessionValue = {
  schemaVersion: WEB2_SCHEMA_VERSION,
  protocol: WEB2_SYNC_PROTOCOL,
  user: { id: id("1"), email: "admin@example.com", displayName: "Administrator", deploymentAdmin: true },
  accounts: [{ id: id("2"), name: "Account", storageId: id("3"), workspaces: [{ id: id("4"), name: "Desktop", pinned: false }] }],
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
    aliased.accounts.push({ id: id("7"), name: "Second", storageId: id("3"), workspaces: [{ id: id("8"), name: "Second Desktop", pinned: false }] });
    expect(() => parseWeb2Session(aliased)).toThrow("inconsistent");
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
