import { describe, expect, test } from "bun:test";
import { DEFAULT_RPC_TIMEOUT_MS, LONG_RUNNING_FILE_MUTATION_METHODS, LONG_RUNNING_RPC_TIMEOUT_MS, RpcDispatcher, usesLongRunningRpcDeadline } from "./dispatcher";
import type { ServiceMethod } from "@hiraya/apps-contracts";
import { createPackageAssetResolver, initializeSandboxFrame, isAppPackageName, ObjectUrlLease, SANDBOX_CSP, SANDBOX_FLAGS, TRUSTED_MARKDOWN_CSP, TRUSTED_MARKDOWN_FLAGS } from "./sandbox";

function host() {
  let closed = false;
  return {
    value: {
      app: { getLaunchContext: async () => ({ protocolVersion: 1, appId: "dev.hiraya.test", launchId: "launch-1", source: "launcher", files: [], folders: [], arguments: [], theme: { mode: "dark", background: "#000", surface: "#111", surfaceElevated: "#222", text: "#fff", textMuted: "#aaa", border: "#333", accent: "#fc0", accentText: "#000", danger: "#f00", focus: "#ff0" } }) },
      storage: { get: async () => "stored" },
      close: () => { closed = true; },
    },
    closed: () => closed,
  };
}

const files = new Proxy({}, { get: () => async () => undefined }) as never;

function messages(port: MessagePort, count: number): Promise<unknown[]> {
  return new Promise((resolve) => {
    const received: unknown[] = [];
    port.onmessage = ({ data }) => {
      received.push(data);
      if (received.length === count) resolve(received);
    };
  });
}

describe("app runtime", () => {
  test("creates the channel only after the launched frame requests a connection", async () => {
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const service = host();
    const dispatcher = new RpcDispatcher({ permissions: [], host: service.value, files });
    let appPort: MessagePort | undefined;
    let init: { appId: string; nonce: string } | undefined;
    const child = {
      postMessage: (message: { appId: string; nonce: string }, _origin: string, ports: MessagePort[]) => {
        init = message;
        appPort = ports[0];
      },
    };
    const frameListeners = new Set<() => void>();
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      addEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) => listeners.delete(listener),
    } });
    try {
      const states: string[] = [];
      const dispose = initializeSandboxFrame({ contentWindow: child, addEventListener: (_type: string, listener: () => void) => frameListeners.add(listener), removeEventListener: (_type: string, listener: () => void) => frameListeners.delete(listener) } as unknown as HTMLIFrameElement, "dev.hiraya.test", dispatcher, { onStateChange: (state) => states.push(state) });
      expect(appPort).toBeUndefined();
      for (const listener of listeners) listener({ source: {}, data: { protocolVersion: 1, type: "hiraya:connect", appId: "dev.hiraya.test" } } as unknown as MessageEvent<unknown>);
      expect(appPort).toBeUndefined();
      for (const listener of listeners) listener({ source: child, data: { protocolVersion: 1, type: "hiraya:connect", appId: "dev.hiraya.test" } } as unknown as MessageEvent<unknown>);
      expect(init?.appId).toBe("dev.hiraya.test");
      const response = new Promise<unknown>((resolve) => { appPort!.onmessage = ({ data }) => resolve(data); });
      appPort!.postMessage({ protocolVersion: 1, type: "hiraya:ready", appId: init!.appId, nonce: init!.nonce });
      appPort!.postMessage({ protocolVersion: 1, type: "request", id: "launch", method: "app.getLaunchContext", params: {} });
      expect(await response).toEqual(expect.objectContaining({ id: "launch", ok: true }));
      expect(states).toEqual(["boot", "connected", "ready"]);
      dispose();
      expect(states.at(-1)).toBe("disposed");
      expect(listeners.size).toBe(0);
    } finally {
      appPort?.close();
      dispatcher.dispose();
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else delete (globalThis as { window?: unknown }).window;
    }
  });

  test("validates requests, applies permissions, and disposes", async () => {
    const service = host();
    const dispatcher = new RpcDispatcher({ permissions: [], host: service.value, files });
    const channel = new MessageChannel();
    const received = messages(channel.port2, 3);
    dispatcher.attach(channel.port1);
    channel.port2.postMessage({ protocolVersion: 1, type: "request", id: "launch", method: "app.getLaunchContext", params: {} });
    channel.port2.postMessage({ protocolVersion: 1, type: "request", id: "storage", method: "storage.get", params: { key: "x" } });
    channel.port2.postMessage({ protocolVersion: 1, type: "request", id: "invalid", method: "window.setDirty", params: { dirty: "yes" } });
    const responses = await received;
    expect(responses).toContainEqual(expect.objectContaining({ id: "launch", ok: true }));
    expect(responses).toContainEqual(expect.objectContaining({ id: "storage", ok: false, error: expect.objectContaining({ code: "PERMISSION_DENIED" }) }));
    expect(responses).toContainEqual(expect.objectContaining({ id: "invalid", ok: false, error: expect.objectContaining({ code: "INVALID_REQUEST" }) }));
    dispatcher.dispose();
    expect(service.closed()).toBe(true);
    channel.port2.close();
  });

  test("detaches a frame channel without closing its host lifecycle", async () => {
    const service = host();
    const dispatcher = new RpcDispatcher({ permissions: [], host: service.value, files });
    const first = new MessageChannel();
    const second = new MessageChannel();
    dispatcher.attach(first.port1);
    dispatcher.detach();
    expect(service.closed()).toBe(false);
    dispatcher.attach(second.port1);
    const response = new Promise<unknown>((resolve) => { second.port2.onmessage = ({ data }) => resolve(data); });
    second.port2.postMessage({ protocolVersion: 1, type: "request", id: "reattached", method: "app.getLaunchContext", params: {} });
    expect(await response).toEqual(expect.objectContaining({ id: "reattached", ok: true }));
    dispatcher.dispose();
    expect(service.closed()).toBe(true);
    first.port2.close();
    second.port2.close();
  });

  test("rechecks effective permissions after a host authority change", async () => {
    const service = host();
    let permissions: Array<"files:read" | "files:write"> = ["files:read", "files:write"];
    const calls: string[] = [];
    const fileApi = new Proxy({}, { get: (_target, key) => async () => { calls.push(String(key)); } }) as never;
    const runtimeHost = { ...service.value, host: { importFiles: async () => { calls.push("host.importFiles"); }, importFolder: async () => { calls.push("host.importFolder"); } } };
    const dispatcher = new RpcDispatcher({ permissions: () => permissions, host: runtimeHost, files: fileApi });
    permissions = ["files:read"];
    const file = "file_0123456789abcdef";
    const folder = "folder_0123456789abcdef";
    const requests = [
      ["files.write", { handle: file, data: new ArrayBuffer(0) }],
      ["files.beginWrite", { handle: file, size: 1 }],
      ["files.writeChunk", { uploadId: "upload-1", offset: 0, data: new ArrayBuffer(1) }],
      ["files.commitWrite", { uploadId: "upload-1" }],
      ["files.abortWrite", { uploadId: "upload-1" }],
      ["files.createFile", { parent: folder, name: "file.txt" }],
      ["files.createFolder", { parent: folder, name: "Folder" }],
      ["files.rename", { handle: file, name: "renamed.txt" }],
      ["files.move", { handle: file, parent: folder }],
      ["files.delete", { handle: file }],
      ["host.importFiles", { parent: folder }],
      ["host.importFolder", { parent: folder }],
    ];
    for (const [method, params] of requests) await dispatcher.dispatch({ protocolVersion: 1, type: "request", id: String(method), method, params });
    expect(calls).toEqual([]);
    dispatcher.dispose();
  });

  test("retains request limits and transfers chunk response buffers", async () => {
    const service = host();
    const data = new Uint8Array([1, 2, 3]).buffer;
    const fileApi = new Proxy({ readChunk: async () => ({ data, mimeType: "application/octet-stream", size: 3, contentRevision: 1 }) }, { get: (target, key) => key in target ? target[key as keyof typeof target] : async () => undefined }) as never;
    const dispatcher = new RpcDispatcher({ permissions: ["files:read", "files:write"], host: service.value, files: fileApi, maxRequestBytes: 1024 * 1024 });
    const channel = new MessageChannel();
    const received = messages(channel.port2, 2);
    dispatcher.attach(channel.port1);
    channel.port2.postMessage({ protocolVersion: 1, type: "request", id: "read", method: "files.readChunk", params: { handle: "file_0123456789abcdef", offset: 0, length: 3 } });
    channel.port2.postMessage({ protocolVersion: 1, type: "request", id: "large", method: "files.writeChunk", params: { uploadId: "upload-1", offset: 0, data: new ArrayBuffer(1024 * 1024) } });
    const responses = await received;
    expect(responses).toContainEqual(expect.objectContaining({ id: "read", ok: true, result: expect.objectContaining({ data: expect.any(ArrayBuffer) }) }));
    expect(responses).toContainEqual(expect.objectContaining({ id: "large", ok: false, error: expect.objectContaining({ code: "INVALID_REQUEST" }) }));
    expect(data.byteLength).toBe(0);
    dispatcher.dispose();
    channel.port2.close();
  });

  test("revokes every package URL exactly once", () => {
    const revoked: string[] = [];
    let id = 0;
    const lease = new ObjectUrlLease({ createObjectURL: () => `blob:${++id}`, revokeObjectURL: (url) => revoked.push(url) });
    lease.create(new Blob(["a"]));
    lease.create(new Blob(["b"]));
    lease.revoke();
    lease.revoke();
    expect(revoked).toEqual(["blob:1", "blob:2"]);
    expect(() => lease.create(new Blob())).toThrow("closed");
  });

  test("allows only opaque local blob sinks needed by package previews and downloads", () => {
    expect(SANDBOX_CSP).toContain("img-src data: blob:");
    expect(SANDBOX_CSP).toContain("media-src data: blob:");
    expect(SANDBOX_CSP).toContain("frame-src data: blob:");
    expect(SANDBOX_CSP).toContain("connect-src 'none'");
    expect(SANDBOX_CSP).toContain("object-src 'none'");
    expect(SANDBOX_CSP).toContain("form-action 'none'");
    expect(SANDBOX_CSP).toContain("navigate-to 'none'");
    expect(SANDBOX_CSP).not.toContain("script-src data: blob:");
    expect(SANDBOX_FLAGS).toBe("allow-scripts allow-downloads");
    expect(SANDBOX_FLAGS).not.toContain("allow-forms");
    expect(SANDBOX_FLAGS).not.toContain("allow-popups");
    expect(SANDBOX_FLAGS).not.toContain("allow-top-navigation");
    expect(TRUSTED_MARKDOWN_CSP).toContain("img-src data: blob: https: http:");
    expect(TRUSTED_MARKDOWN_CSP).toContain("connect-src 'none'");
    expect(TRUSTED_MARKDOWN_FLAGS).toContain("allow-popups-to-escape-sandbox");
  });

  test("allows the initial document load before readiness and navigates on the next load", async () => {
    const listeners = new Set<() => void>();
    const windowListeners = new Set<(event: MessageEvent<unknown>) => void>();
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const service = host();
    const dispatcher = new RpcDispatcher({ permissions: [], host: service.value, files });
    let replaced = 0;
    let navigated = 0;
    let init: { appId: string; nonce: string } | undefined;
    let appPort: MessagePort | undefined;
    const frame = {
      contentWindow: { postMessage: (message: { appId: string; nonce: string }, _origin: string, ports: MessagePort[]) => { init = message; appPort = ports[0]; } },
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      replaceWith: () => { replaced += 1; },
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) => windowListeners.add(listener), removeEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) => windowListeners.delete(listener) } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({}) } });
    try {
      initializeSandboxFrame(frame as unknown as HTMLIFrameElement, "dev.hiraya.test", dispatcher, { onNavigation: () => { navigated += 1; } });
      for (const listener of listeners) listener();
      expect(replaced).toBe(0);
      for (const listener of windowListeners) listener({ source: frame.contentWindow, data: { protocolVersion: 1, type: "hiraya:connect", appId: "dev.hiraya.test" } } as unknown as MessageEvent<unknown>);
      appPort!.postMessage({ protocolVersion: 1, type: "hiraya:ready", appId: init!.appId, nonce: init!.nonce });
      const ready = new Promise<unknown>((resolve) => { appPort!.onmessage = ({ data }) => resolve(data); });
      appPort!.postMessage({ protocolVersion: 1, type: "request", id: "ready", method: "app.getLaunchContext", params: {} });
      await ready;
      for (const listener of listeners) listener();
      expect(replaced).toBe(1);
      expect(navigated).toBe(1);
      expect(listeners.size).toBe(0);
    } finally {
      dispatcher.dispose();
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else delete (globalThis as { window?: unknown }).window;
      if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else delete (globalThis as { document?: unknown }).document;
    }
  });

  test("allows the initial document load after readiness and navigates on the next load", async () => {
    const listeners = new Set<() => void>();
    const windowListeners = new Set<(event: MessageEvent<unknown>) => void>();
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const dispatcher = new RpcDispatcher({ permissions: [], host: host().value, files });
    let replaced = 0;
    let navigated = 0;
    let init: { appId: string; nonce: string } | undefined;
    let appPort: MessagePort | undefined;
    const frame = {
      contentWindow: { postMessage: (message: { appId: string; nonce: string }, _origin: string, ports: MessagePort[]) => { init = message; appPort = ports[0]; } },
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      replaceWith: () => { replaced += 1; },
    };
    Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) => windowListeners.add(listener), removeEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) => windowListeners.delete(listener) } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({}) } });
    try {
      initializeSandboxFrame(frame as unknown as HTMLIFrameElement, "dev.hiraya.test", dispatcher, { onNavigation: () => { navigated += 1; } });
      for (const listener of windowListeners) listener({ source: frame.contentWindow, data: { protocolVersion: 1, type: "hiraya:connect", appId: "dev.hiraya.test" } } as unknown as MessageEvent<unknown>);
      appPort!.postMessage({ protocolVersion: 1, type: "hiraya:ready", appId: init!.appId, nonce: init!.nonce });
      const ready = new Promise<unknown>((resolve) => { appPort!.onmessage = ({ data }) => resolve(data); });
      appPort!.postMessage({ protocolVersion: 1, type: "request", id: "ready", method: "app.getLaunchContext", params: {} });
      await ready;
      for (const listener of listeners) listener();
      expect(replaced).toBe(0);
      expect(navigated).toBe(0);
      for (const listener of listeners) listener();
      expect(replaced).toBe(1);
      expect(navigated).toBe(1);
    } finally {
      appPort?.close();
      dispatcher.dispose();
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else delete (globalThis as { window?: unknown }).window;
      if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else delete (globalThis as { document?: unknown }).document;
    }
  });

  test("starts the boot deadline at initialization and bounds pre-ready failure", () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const service = host();
    const dispatcher = new RpcDispatcher({ permissions: [], host: service.value, files });
    let deadline: (() => void) | undefined;
    const states: string[] = [];
    Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener: () => undefined, removeEventListener: () => undefined } });
    try {
      initializeSandboxFrame({ contentWindow: {}, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as HTMLIFrameElement, "dev.hiraya.test", dispatcher, {
        onStateChange: (state) => states.push(state),
        timers: { set: (callback) => { deadline = callback; return 1; }, clear: () => undefined },
      });
      expect(deadline).toBeDefined();
      deadline!();
      expect(states).toEqual(["boot", "disposed"]);
      expect(service.closed()).toBe(true);
    } finally {
      dispatcher.dispose();
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else delete (globalThis as { window?: unknown }).window;
    }
  });

  test("uses the default host deadline for ordinary methods", async () => {
    expect(DEFAULT_RPC_TIMEOUT_MS).toBe(15_000);
    const service = host();
    let started!: () => void;
    const invoked = new Promise<void>((resolve) => { started = resolve; });
    let complete!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { complete = resolve; });
    let scheduled = 0;
    const dispatcher = new RpcDispatcher({ permissions: ["storage"], host: { ...service.value, storage: { get: () => { started(); return pending; } } }, files, timers: { set: (_callback, timeoutMs) => { scheduled = timeoutMs; return 1; }, clear: () => undefined } });
    const channel = new MessageChannel();
    const response = messages(channel.port2, 1);
    dispatcher.attach(channel.port1);
    channel.port2.postMessage({ protocolVersion: 1, type: "request", id: "ordinary", method: "storage.get", params: { key: "x" } });
    await invoked;
    expect(scheduled).toBe(DEFAULT_RPC_TIMEOUT_MS);
    complete("done");
    expect(await response).toEqual([expect.objectContaining({ id: "ordinary", ok: true, result: "done" })]);
    dispatcher.dispose();
    channel.port2.close();
  });

  test("classifies every direct, staged, metadata, and recursive file mutation as long-running", () => {
    const expected = [
      "files.write", "files.beginWrite", "files.writeChunk", "files.commitWrite", "files.abortWrite",
      "files.createFile", "files.createFolder", "files.rename", "files.move", "files.delete", "files.deleteMany",
    ] satisfies ServiceMethod[];
    expect([...LONG_RUNNING_FILE_MUTATION_METHODS]).toEqual(expected);
    for (const method of expected) expect(usesLongRunningRpcDeadline(method)).toBe(true);
    for (const method of ["files.stat", "files.read", "storage.set"] satisfies ServiceMethod[]) expect(usesLongRunningRpcDeadline(method)).toBe(false);
  });

  test("uses the long host deadline and existing INTERNAL semantics for staged commit", async () => {
    expect(LONG_RUNNING_RPC_TIMEOUT_MS).toBe(120_000);
    const service = host();
    let started!: () => void;
    const invoked = new Promise<void>((resolve) => { started = resolve; });
    let complete!: () => void;
    const operation = new Promise<void>((resolve) => { complete = resolve; });
    let expire!: () => void;
    let scheduled = 0;
    const dispatcher = new RpcDispatcher({
      permissions: ["files:write"],
      host: service.value,
      files: new Proxy({ commitWrite: () => { started(); return operation; } }, { get: (target, key) => key in target ? target[key as keyof typeof target] : async () => undefined }) as never,
      timers: { set: (callback, timeoutMs) => { expire = callback; scheduled = timeoutMs; return 1; }, clear: () => undefined },
    });
    const channel = new MessageChannel();
    const response = messages(channel.port2, 1);
    dispatcher.attach(channel.port1);
    channel.port2.postMessage({ protocolVersion: 1, type: "request", id: "mutation", method: "files.commitWrite", params: { uploadId: "upload-1" } });
    await invoked;
    expect(scheduled).toBe(LONG_RUNNING_RPC_TIMEOUT_MS);
    expire();
    expect(await response).toEqual([expect.objectContaining({ id: "mutation", ok: false, error: expect.objectContaining({ code: "INTERNAL" }) })]);
    complete();
    dispatcher.dispose();
    channel.port2.close();
  });

  test("embeds package dependencies for an opaque sandbox origin", () => {
    const encoder = new TextEncoder();
    const files = new Map([
      ["index.html", encoder.encode("<!doctype html>")],
      ["assets/app.js", encoder.encode('import "./dependency.js";')],
      ["assets/dependency.js", encoder.encode("globalThis.loaded = true;")],
      ["assets/app.css", encoder.encode('@import "./theme.css"; body { background: url("./mark.svg") }')],
      ["assets/theme.css", encoder.encode("body { color: CanvasText; }")],
      ["assets/mark.svg", encoder.encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>")],
    ]);
    const resolve = createPackageAssetResolver(files, "index.html");
    const dependencyURL = resolve("assets/dependency.js")!;
    const markURL = resolve("assets/mark.svg")!;
    const themeURL = resolve("assets/theme.css")!;
    const script = atob(resolve("assets/app.js")!.split(",", 2)[1]);
    const stylesheet = atob(resolve("assets/app.css")!.split(",", 2)[1]);

    expect(resolve("index.html")).toBeUndefined();
    expect(dependencyURL).toStartWith("data:text/javascript;base64,");
    expect(markURL).toStartWith("data:image/svg+xml;base64,");
    expect(script).toContain(dependencyURL);
    expect(stylesheet).toContain(markURL);
    expect(stylesheet).toContain(themeURL);
  });

  test("recognizes only the exact package extension", () => {
    expect(isAppPackageName("Hello.HIRAYA.APP")).toBe(true);
    expect(isAppPackageName("index.html")).toBe(false);
    expect(isAppPackageName("fake.hiraya.app.txt")).toBe(false);
  });
});
