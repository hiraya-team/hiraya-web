import { describe, expect, test } from "bun:test";
import { connectHiraya, HirayaSdkError, type FileHandle, type ThemeTarget, type ThemeTokens } from "./index";

const darkTheme: ThemeTokens = {
  mode: "dark", background: "#000", surface: "#111", surfaceElevated: "#222", text: "#fff", textMuted: "#aaa", border: "#333", accent: "#fc0", accentText: "#000", danger: "#f00", focus: "#ff0",
};

const lightTheme: ThemeTokens = {
  mode: "light", background: "#fff", surface: "#eee", surfaceElevated: "#ddd", text: "#111", textMuted: "#555", border: "#ccc", accent: "#06c", accentText: "#fff", danger: "#c00", focus: "#09f",
};

function fakeThemeTarget(): { target: ThemeTarget; tokens: Map<string, string> } {
  const tokens = new Map<string, string>();
  return {
    target: {
      dataset: {},
      style: {
        setProperty: (name, value) => {
          if (value === null) tokens.delete(name);
          else tokens.set(name, value);
        },
      },
    },
    tokens,
  };
}

describe("apps SDK", () => {
  test("waits for one exact parent init and ignores hostile frames", async () => {
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    const connectMessages: unknown[] = [];
    const parent = { postMessage: (message: unknown) => connectMessages.push(message) };
    const fakeWindow = {
      parent,
      addEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) => listeners.delete(listener),
    };
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
    const hostile = new MessageChannel();
    const channel = new MessageChannel();
    try {
      const connecting = connectHiraya({ appId: "dev.hiraya.test", handshakeTimeoutMs: 100 });
      expect(connectMessages).toEqual([{ protocolVersion: 1, type: "hiraya:connect", appId: "dev.hiraya.test" }]);
      for (const listener of listeners) listener({ source: {}, data: { protocolVersion: 1, type: "hiraya:init", appId: "dev.hiraya.test", nonce: "0123456789abcdef" }, ports: [hostile.port1] } as unknown as MessageEvent<unknown>);
      expect(listeners.size).toBe(1);
      const ready = new Promise<unknown>((resolve) => { channel.port2.onmessage = ({ data }) => resolve(data); });
      for (const listener of listeners) listener({ source: parent, data: { protocolVersion: 1, type: "hiraya:init", appId: "dev.hiraya.test", nonce: "0123456789abcdef" }, ports: [channel.port1] } as unknown as MessageEvent<unknown>);
      const client = await connecting;
      expect(await ready).toEqual({ protocolVersion: 1, type: "hiraya:ready", appId: "dev.hiraya.test", nonce: "0123456789abcdef" });
      expect(listeners.size).toBe(0);
      client.close();
    } finally {
      hostile.port1.close(); hostile.port2.close(); channel.port2.close();
      if (descriptor) Object.defineProperty(globalThis, "window", descriptor); else delete (globalThis as { window?: unknown }).window;
    }
  });

  test("dispatches typed requests and remote errors", async () => {
    const channel = new MessageChannel();
    channel.port2.onmessage = ({ data }) => {
      const result = data.method === "storage.get" ? "value" : undefined;
      channel.port2.postMessage({ protocolVersion: 1, type: "response", id: data.id, ok: true, result });
    };
    const client = await connectHiraya({ port: channel.port1 });
    expect(await client.storage.get("key")).toBe("value");
    client.close();
    channel.port2.close();

    const deniedChannel = new MessageChannel();
    deniedChannel.port2.onmessage = ({ data }) => deniedChannel.port2.postMessage({
      protocolVersion: 1,
      type: "response",
      id: data.id,
      ok: false,
      error: { code: "PERMISSION_DENIED", message: "Denied" },
    });
    const deniedClient = await connectHiraya({ port: deniedChannel.port1 });
    await expect(deniedClient.theme.get()).rejects.toEqual(expect.objectContaining({ name: "HirayaSdkError", code: "PERMISSION_DENIED" }));
    deniedClient.close();
    deniedChannel.port2.close();
  });

  test("exposes launch, revision-safe write, and dirty window requests", async () => {
    const channel = new MessageChannel();
    const requests: unknown[] = [];
    channel.port2.onmessage = ({ data }) => {
      requests.push(data);
      channel.port2.postMessage({ protocolVersion: 1, type: "response", id: data.id, ok: true, result: data.method === "app.getLaunchContext" ? {
        protocolVersion: 1, appId: "dev.hiraya.test", launchId: "launch-1", source: "launcher", files: [], folders: [], arguments: [],
        theme: { mode: "dark", background: "#000", surface: "#111", surfaceElevated: "#222", text: "#fff", textMuted: "#aaa", border: "#333", accent: "#fc0", accentText: "#000", danger: "#f00", focus: "#ff0" },
      } : data.method === "files.write" ? { handle: data.params.handle, name: "test.txt", mimeType: "text/plain", size: 0, modifiedAt: 1, parent: null, contentRevision: 8 } : undefined });
    };
    const client = await connectHiraya({ port: channel.port1 });
    await client.app.getLaunchContext();
    await client.files.write("file_0123456789abcdef" as FileHandle, new ArrayBuffer(0), { expectedRevision: 7, mimeType: "text/plain" });
    await client.window.setDirty(true);
    await client.host.openEntry("file_0123456789abcdef" as FileHandle);
    await client.files.deleteMany(["file_0123456789abcdef" as FileHandle], true);
    expect(requests).toEqual([
      expect.objectContaining({ method: "app.getLaunchContext", params: {} }),
      expect.objectContaining({ method: "files.write", params: expect.objectContaining({ expectedRevision: 7, mimeType: "text/plain" }) }),
      expect.objectContaining({ method: "window.setDirty", params: { dirty: true } }),
      expect.objectContaining({ method: "host.openEntry", params: { handle: "file_0123456789abcdef" } }),
      expect.objectContaining({ method: "files.deleteMany", params: { handles: ["file_0123456789abcdef"], recursive: true } }),
    ]);
    client.close();
    channel.port2.close();
  });

  test("projects launch, queried, and changed themes onto an injected target", async () => {
    const channel = new MessageChannel();
    const { target, tokens } = fakeThemeTarget();
    channel.port2.onmessage = ({ data }) => channel.port2.postMessage({
      protocolVersion: 1,
      type: "response",
      id: data.id,
      ok: true,
      result: data.method === "app.getLaunchContext"
        ? { protocolVersion: 1, appId: "dev.hiraya.test", launchId: "launch-1", source: "launcher", files: [], folders: [], arguments: [], theme: darkTheme }
        : data.method === "theme.get" ? lightTheme : undefined,
    });
    const client = await connectHiraya({ port: channel.port1, themeTarget: target });

    await client.app.getLaunchContext();
    expect(target.dataset.theme).toBe("dark");
    expect(tokens.get("--hiraya-surface-elevated")).toBe("#222");

    await client.theme.get();
    expect(target.dataset.theme).toBe("light");
    expect(tokens.get("--hiraya-accent")).toBe("#06c");

    const changed = new Promise<void>((resolve) => client.on("theme.changed", (theme) => {
      expect(theme).toEqual(darkTheme);
      expect(target.dataset.theme).toBe("dark");
      expect(tokens.get("--hiraya-focus")).toBe("#ff0");
      resolve();
    }));
    channel.port2.postMessage({ protocolVersion: 1, type: "event", event: "theme.changed", payload: darkTheme });
    await changed;
    client.close();
    channel.port2.close();
  });

  test("reads and atomically stages files across bounded transferable chunks", async () => {
    const channel = new MessageChannel();
    const handle = "file_0123456789abcdef" as FileHandle;
    const source = new Uint8Array(2 * 1024 * 1024 + 5).map((_, index) => index % 251);
    const written: Array<{ offset: number; data: Uint8Array }> = [];
    channel.port2.onmessage = ({ data }) => {
      let result: unknown;
      if (data.method === "files.stat") result = { kind: "file", metadata: { handle, name: "large.bin", mimeType: "application/octet-stream", size: source.byteLength, modifiedAt: 1, parent: null, contentRevision: 4 } };
      if (data.method === "files.readChunk") result = { data: source.slice(data.params.offset, data.params.offset + data.params.length).buffer, mimeType: "application/octet-stream", size: source.byteLength, contentRevision: 4 };
      if (data.method === "files.beginWrite") result = { uploadId: "upload-1", chunkSize: 1024 * 1024 };
      if (data.method === "files.writeChunk") { written.push({ offset: data.params.offset, data: new Uint8Array(data.params.data) }); result = undefined; }
      if (data.method === "files.commitWrite") result = { handle, name: "large.bin", mimeType: "application/octet-stream", size: source.byteLength, modifiedAt: 2, parent: null, contentRevision: 5 };
      channel.port2.postMessage({ protocolVersion: 1, type: "response", id: data.id, ok: true, result });
    };
    const client = await connectHiraya({ port: channel.port1 });
    expect(new Uint8Array((await client.files.readAll(handle)).data)).toEqual(source);
    expect((await client.files.writeAll(handle, source.buffer.slice(0), { expectedRevision: 4 })).contentRevision).toBe(5);
    expect(written.map(({ offset, data }) => [offset, data.byteLength])).toEqual([[0, 1024 * 1024], [1024 * 1024, 1024 * 1024], [2 * 1024 * 1024, 5]]);
    expect(written[2].data).toEqual(source.slice(-5));
    client.close();
    channel.port2.close();
  });

  test("supports event unsubscribe", async () => {
    const channel = new MessageChannel();
    channel.port2.onmessage = ({ data }) => channel.port2.postMessage({ protocolVersion: 1, type: "response", id: data.id, ok: true, result: "barrier" });
    const client = await connectHiraya({ port: channel.port1 });
    const received: string[] = [];
    let first!: () => void;
    const delivered = new Promise<void>((resolve) => { first = resolve; });
    const unsubscribe = client.on("commands.invoked", ({ id }) => { received.push(id); first(); });
    channel.port2.postMessage({ protocolVersion: 1, type: "event", event: "commands.invoked", payload: { id: "save" } });
    await delivered;
    unsubscribe();
    channel.port2.postMessage({ protocolVersion: 1, type: "event", event: "commands.invoked", payload: { id: "open" } });
    await client.storage.get("barrier");
    expect(received).toEqual(["save"]);
    client.close();
    channel.port2.close();
  });

  test("exposes live effective app capabilities", async () => {
    const channel = new MessageChannel();
    channel.port2.onmessage = ({ data }) => channel.port2.postMessage({ protocolVersion: 1, type: "response", id: data.id, ok: true, result: { files: { write: false, writeReason: "read-only" }, externalEmbeddedPreviews: false } });
    const client = await connectHiraya({ port: channel.port1 });
    expect(await client.app.getCapabilities()).toEqual({ files: { write: false, writeReason: "read-only" }, externalEmbeddedPreviews: false });
    const changes: boolean[] = [];
    let changed!: () => void;
    const delivered = new Promise<void>((resolve) => { changed = resolve; });
    client.on("capabilities.changed", ({ files }) => { changes.push(files.write); changed(); });
    channel.port2.postMessage({ protocolVersion: 1, type: "event", event: "capabilities.changed", payload: { files: { write: true, writeReason: "available" }, externalEmbeddedPreviews: false } });
    await delivered;
    expect(changes).toEqual([true]);
    client.close();
    channel.port2.close();
  });

  test("keeps explicit deadlines local, supports abort, and rejects on close", async () => {
    const channel = new MessageChannel();
    const client = await connectHiraya({ port: channel.port1, requestTimeoutMs: 10 });
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(client.storage.get("key", { signal: preAborted.signal })).rejects.toEqual(expect.objectContaining({ code: "CANCELLED" }));
    const request = new Promise<unknown>((resolve) => { channel.port2.onmessage = ({ data }) => resolve(data); });
    const controller = new AbortController();
    const inFlight = client.storage.get("key", { signal: controller.signal, timeoutMs: 120_000 });
    const sent = await request;
    expect(sent).toEqual({ protocolVersion: 1, type: "request", id: expect.any(String), method: "storage.get", params: { key: "key" } });
    controller.abort();
    await expect(inFlight).rejects.toEqual(expect.objectContaining({ code: "CANCELLED" }));
    await expect(client.storage.get("key")).rejects.toEqual(expect.objectContaining({ code: "TIMEOUT" }));
    const pending = client.storage.get("key", { timeoutMs: 1_000 });
    client.close();
    await expect(pending).rejects.toBeInstanceOf(HirayaSdkError);
    await expect(client.storage.get("key")).rejects.toEqual(expect.objectContaining({ code: "UNAVAILABLE" }));
    channel.port2.close();
  });
});
