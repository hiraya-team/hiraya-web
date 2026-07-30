import { describe, expect, test } from "bun:test";
import {
  parseFileHandle,
  parseLaunchContext,
  parseManifestV2,
  parseRpcEvent,
  parseRpcRequest,
  parseRpcResponse,
  parseServiceResult,
  parseThemeTokens,
} from "./index";

const theme = {
  mode: "dark",
  background: "#10201c",
  surface: "#172a25",
  surfaceElevated: "#20352f",
  text: "#f4efe2",
  textMuted: "#b8b4a8",
  border: "#43554e",
  accent: "#d99b43",
  accentText: "#17120b",
  danger: "#d66b62",
  focus: "#f1bd69",
} as const;

describe("apps contracts", () => {
  test("strictly parses manifest v2 for UI runtime 1", () => {
    const manifest = {
      schemaVersion: 2,
      uiRuntime: 1,
      id: "dev.hiraya.notes",
      name: "Notes",
      version: "1.2.0",
      entrypoint: "dist/index.html",
      permissions: ["files:read", "storage"],
    };
    expect(parseManifestV2(manifest)).toEqual(manifest);
    expect(() => parseManifestV2({ ...manifest, schemaVersion: 1 })).toThrow("schema version");
    expect(() => parseManifestV2({ ...manifest, uiRuntime: 2 })).toThrow("UI runtime");
    expect(() => parseManifestV2({ ...manifest, extra: true })).toThrow("unsupported shape");
    expect(() => parseManifestV2({ ...manifest, permissions: ["files:read", "files:read"] })).toThrow("duplicates");
    expect(() => parseManifestV2({ ...manifest, entrypoint: "../index.html" })).toThrow("entrypoint");
    expect(parseManifestV2({ ...manifest, window: { width: 900, height: 700, minWidth: 400, minHeight: 300 } }).window).toEqual({ width: 900, height: 700, minWidth: 400, minHeight: 300 });
    expect(() => parseManifestV2({ ...manifest, window: { width: 300, height: 700, minWidth: 400, minHeight: 300 } })).toThrow("minimums");
    expect(() => parseManifestV2({ ...manifest, window: { width: 900, height: 700, minWidth: 400, minHeight: 300, extra: 1 } })).toThrow("unsupported shape");
    expect(() => parseManifestV2({ ...manifest, window: { width: 900.5, height: 700, minWidth: 400, minHeight: 300 } })).toThrow("width");
    expect(() => parseManifestV2({ ...manifest, window: { width: 900, height: 700, minWidth: 400 } })).toThrow("unsupported shape");
  });

  test("brands only opaque typed handles", () => {
    expect(parseFileHandle("file_0123456789abcdef")).toBe("file_0123456789abcdef");
    expect(() => parseFileHandle("folder_0123456789abcdef")).toThrow("File handle");
    expect(() => parseFileHandle("file/project/readme")).toThrow("File handle");
  });

  test("strictly parses launch and theme contracts", () => {
    const context = {
      protocolVersion: 1,
      appId: "dev.hiraya.notes",
      launchId: "launch-1",
      source: "file",
      files: ["file_0123456789abcdef"],
      folders: ["folder_0123456789abcdef"],
      arguments: ["readonly"],
      theme,
    };
    expect(parseLaunchContext(context)).toEqual(context);
    expect(() => parseThemeTokens({ ...theme, unknown: "#fff" })).toThrow("unsupported shape");
  });

  test("rejects loose RPC responses and errors", () => {
    const response = { protocolVersion: 1, type: "response", id: "r1", ok: false, error: { code: "NOT_FOUND", message: "Missing" } };
    expect(parseRpcResponse(response)).toEqual(response);
    expect(() => parseRpcResponse({ ...response, result: null })).toThrow("unsupported shape");
    expect(() => parseRpcResponse({ ...response, error: { code: "NOPE", message: "Missing" } })).toThrow("code");
  });

  test("strictly validates method params, results, and event payloads", () => {
    const oldSdkRequest = { protocolVersion: 1, type: "request", id: "r1", method: "window.setDirty", params: { dirty: true } };
    expect(parseRpcRequest(oldSdkRequest)).toEqual(oldSdkRequest);
    expect(() => parseRpcRequest({ ...oldSdkRequest, timeoutMs: 120_000 })).toThrow("unsupported shape");
    expect(() => parseRpcRequest({ protocolVersion: 1, type: "request", id: "r1", method: "window.setDirty", params: { dirty: "true" } })).toThrow("dirty");
    expect(() => parseRpcRequest({ protocolVersion: 1, type: "request", id: "r1", method: "storage.get", params: { key: "x", extra: true } })).toThrow("unsupported shape");
    expect(parseServiceResult("dialogs.confirm", true)).toBe(true);
    expect(() => parseServiceResult("dialogs.confirm", "yes")).toThrow("Confirmation");
    expect(parseRpcEvent({ protocolVersion: 1, type: "event", event: "commands.invoked", payload: { id: "save" } })).toEqual(expect.objectContaining({ payload: { id: "save" } }));
    const capabilities = { files: { write: false, writeReason: "shared-offline" }, externalEmbeddedPreviews: false } as const;
    expect(parseServiceResult("app.getCapabilities", capabilities)).toEqual(capabilities);
    expect(parseRpcEvent({ protocolVersion: 1, type: "event", event: "capabilities.changed", payload: capabilities })).toEqual(expect.objectContaining({ payload: capabilities }));
    expect(() => parseServiceResult("app.getCapabilities", { ...capabilities, files: { write: false, writeReason: "unknown" } })).toThrow("reason");
    expect(() => parseRpcEvent({ protocolVersion: 1, type: "event", event: "commands.invoked", payload: { id: 1 } })).toThrow("ID");
    expect(parseRpcRequest({ protocolVersion: 1, type: "request", id: "r2", method: "files.readChunk", params: { handle: "file_0123456789abcdef", offset: 4, length: 1024 * 1024 } })).toEqual(expect.objectContaining({ params: expect.objectContaining({ offset: 4, length: 1024 * 1024 }) }));
    expect(() => parseRpcRequest({ protocolVersion: 1, type: "request", id: "r2", method: "files.readChunk", params: { handle: "file_0123456789abcdef", offset: 0, length: 1024 * 1024 + 1 } })).toThrow("length");
    expect(() => parseRpcRequest({ protocolVersion: 1, type: "request", id: "r3", method: "files.writeChunk", params: { uploadId: "upload-1", offset: 0, data: new ArrayBuffer(1024 * 1024 + 1) } })).toThrow("chunk limit");
    expect(parseRpcRequest({ protocolVersion: 1, type: "request", id: "r4", method: "files.resolve", params: { handle: "file_0123456789abcdef", path: "../images/icon.png" } })).toEqual(expect.objectContaining({ params: expect.objectContaining({ path: "../images/icon.png" }) }));
    expect(parseRpcRequest({ protocolVersion: 1, type: "request", id: "r5", method: "files.resolve", params: { handle: "folder_0123456789abcdef", path: "images/icon.png" } })).toEqual(expect.objectContaining({ params: expect.objectContaining({ handle: "folder_0123456789abcdef" }) }));
    expect(parseRpcRequest({ protocolVersion: 1, type: "request", id: "r6", method: "host.setOfflinePinned", params: { handles: ["file_0123456789abcdef"], pinned: true } })).toEqual(expect.objectContaining({ params: expect.objectContaining({ pinned: true }) }));
    expect(() => parseRpcRequest({ protocolVersion: 1, type: "request", id: "r4", method: "files.resolve", params: { handle: "file_0123456789abcdef", path: "/secret" } })).toThrow("relative path");
    expect(parseRpcRequest({ protocolVersion: 1, type: "request", id: "r7", method: "files.deleteMany", params: { handles: ["file_0123456789abcdef", "folder_0123456789abcdef"], recursive: true } })).toEqual(expect.objectContaining({ params: { handles: ["file_0123456789abcdef", "folder_0123456789abcdef"], recursive: true } }));
    expect(() => parseRpcRequest({ protocolVersion: 1, type: "request", id: "r8", method: "files.deleteMany", params: { handles: ["file_0123456789abcdef", "file_0123456789abcdef"] } })).toThrow("duplicates");
  });
});
