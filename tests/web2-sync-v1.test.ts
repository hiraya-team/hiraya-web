import { describe, expect, test } from "bun:test";
import {
  WEB2_CHUNK_SIZE,
  WEB2_INDEXED_DB_PREFIX,
  WEB2_OPFS_PREFIX,
  WEB2_SCHEMA_VERSION,
  SETTING_NAMESPACES,
  canonicalManifestBytes,
  canonicalManifestSha256,
  isRecord,
  parseCanonicalName,
  parseManifest,
  parseMimeType,
  parseNonNegativeSafeInteger,
  parsePosition,
  parseSha256,
  parseStableId,
  parseSettingNamespace,
  resolveFieldConflict,
  sha256Hex,
  winningOperationTuple,
  type OperationTuple,
} from "../src/filesystem/model";
import { operationAffectedIdentities, parseWorkspaceOperation } from "../src/filesystem/operations";
import {
  WEB2_SYNC_PROTOCOL,
  parseBootstrap,
  parseChunkDownloadRequest,
  parseChunkDownloadResult,
  parseChunkUploadRequest,
  parseChunkUploadResult,
  parseHydrationPage,
  parseHydrationTarget,
  parseOperationReceipt,
  parsePullResult,
  parsePushRequest,
  parsePushResult,
  replayOperationReceipt,
} from "../src/sync/protocol";

type Case = { name: string; value: unknown };
type InvalidKindCase = Case & { kind: string };
type PrimitiveCase = { name: string; valid: boolean; value: unknown };
type Corpus = {
  schemaVersion: number;
  protocol: string;
  constants: { indexedDbPrefix: string; opfsPrefix: string; chunkSize: number };
  primitives: Record<"stableIds" | "names" | "mimeTypes" | "nonNegativeIntegers" | "positions" | "sha256", PrimitiveCase[]>;
  manifests: { valid: Array<Case & { canonicalJson: string; sha256: string }>; invalid: Case[] };
  operations: { valid: Array<Case & { affected: string[] }>; invalid: InvalidKindCase[] };
  hydrationTargets: { valid: Case[]; invalid: InvalidKindCase[] };
  bootstrap: { valid: Case[]; invalid: Case[] };
  hydrationPages: { valid: Case[]; invalid: Case[] };
  pullResults: { valid: Case[]; invalid: InvalidKindCase[] };
  pushResults: { valid: Case[]; invalid: InvalidKindCase[] };
  pushRequests: { valid: Case[]; invalid: Case[] };
  conflictMatrix: { valid: Array<{ name: string; category: string; input: unknown; expected: unknown }>; invalid: Case[] };
  receipts: {
    valid: Case[];
    invalid: Case[];
    replay: Array<{ name: string; receipt: unknown; operationId: string; inputHash: string; expected: unknown }>;
  };
  tupleOrdering: Array<{ name: string; left: OperationTuple; right: OperationTuple; winner: "left" | "right" }>;
  chunkNegotiation: {
    uploadRequests: { valid: Case[]; invalid: Case[] };
    uploadResults: { valid: Array<Case & { expectedManifest: unknown }>; invalid: Array<Case & { expectedManifest: unknown }> };
    downloadRequests: { valid: Case[]; invalid: Case[] };
    downloadResults: { valid: Case[]; invalid: Case[] };
  };
};

const corpusBytes = new Uint8Array(await Bun.file(new URL("../testdata/web2-sync-v1/corpus.json", import.meta.url)).arrayBuffer());
const raw = JSON.parse(new TextDecoder().decode(corpusBytes)) as unknown;

function exact(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  expect(isRecord(value), `${label} must be an object`).toBe(true);
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  expect(Object.keys(value).sort(), `${label} keys`).toEqual([...keys].sort());
}

function cases(value: unknown, keys: readonly string[], label: string) {
  expect(Array.isArray(value), `${label} must be an array`).toBe(true);
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  expect(value.length, `${label} must not be empty`).toBeGreaterThan(0);
  const names = value.map((item, index) => {
    exact(item, keys, `${label}[${index}]`);
    expect(typeof item.name).toBe("string");
    expect(String(item.name).trim()).not.toBe("");
    return item.name;
  });
  expect(new Set(names).size, `${label} names must be unique`).toBe(names.length);
}

function validAndInvalid(value: unknown, validKeys: readonly string[], invalidKeys: readonly string[], label: string) {
  exact(value, ["valid", "invalid"], label);
  cases(value.valid, validKeys, `${label}.valid`);
  cases(value.invalid, invalidKeys, `${label}.invalid`);
}

function parseCorpus(value: unknown): Corpus {
  exact(value, ["schemaVersion", "protocol", "constants", "primitives", "manifests", "operations", "hydrationTargets", "bootstrap", "hydrationPages", "pullResults", "pushResults", "pushRequests", "conflictMatrix", "receipts", "tupleOrdering", "chunkNegotiation"], "corpus");
  exact(value.constants, ["indexedDbPrefix", "opfsPrefix", "chunkSize"], "constants");
  exact(value.primitives, ["stableIds", "names", "mimeTypes", "nonNegativeIntegers", "positions", "sha256"], "primitives");
  for (const [name, section] of Object.entries(value.primitives)) cases(section, ["name", "valid", "value"], `primitives.${name}`);
  validAndInvalid(value.manifests, ["name", "value", "canonicalJson", "sha256"], ["name", "value"], "manifests");
  validAndInvalid(value.operations, ["name", "value", "affected"], ["name", "kind", "value"], "operations");
  validAndInvalid(value.hydrationTargets, ["name", "value"], ["name", "kind", "value"], "hydrationTargets");
  validAndInvalid(value.bootstrap, ["name", "value"], ["name", "value"], "bootstrap");
  validAndInvalid(value.hydrationPages, ["name", "value"], ["name", "value"], "hydrationPages");
  validAndInvalid(value.pullResults, ["name", "value"], ["name", "kind", "value"], "pullResults");
  validAndInvalid(value.pushResults, ["name", "value"], ["name", "kind", "value"], "pushResults");
  validAndInvalid(value.pushRequests, ["name", "value"], ["name", "value"], "pushRequests");
  validAndInvalid(value.conflictMatrix, ["name", "category", "input", "expected"], ["name", "value"], "conflictMatrix");
  exact(value.receipts, ["valid", "invalid", "replay"], "receipts");
  cases(value.receipts.valid, ["name", "value"], "receipts.valid");
  cases(value.receipts.invalid, ["name", "value"], "receipts.invalid");
  cases(value.receipts.replay, ["name", "receipt", "operationId", "inputHash", "expected"], "receipts.replay");
  cases(value.tupleOrdering, ["name", "left", "right", "winner"], "tupleOrdering");
  exact(value.chunkNegotiation, ["uploadRequests", "uploadResults", "downloadRequests", "downloadResults"], "chunkNegotiation");
  validAndInvalid(value.chunkNegotiation.uploadRequests, ["name", "value"], ["name", "value"], "chunkNegotiation.uploadRequests");
  validAndInvalid(value.chunkNegotiation.uploadResults, ["name", "expectedManifest", "value"], ["name", "expectedManifest", "value"], "chunkNegotiation.uploadResults");
  validAndInvalid(value.chunkNegotiation.downloadRequests, ["name", "value"], ["name", "value"], "chunkNegotiation.downloadRequests");
  validAndInvalid(value.chunkNegotiation.downloadResults, ["name", "value"], ["name", "value"], "chunkNegotiation.downloadResults");
  return value as unknown as Corpus;
}

const corpus = parseCorpus(raw);

function accepts(parse: (value: unknown) => unknown, item: PrimitiveCase) {
  const accepted = (() => { try { parse(item.value); return true; } catch { return false; } })();
  expect(accepted, item.name).toBe(item.valid);
}

const OPERATION_KINDS = ["create", "write", "copy", "rename", "move", "position", "transfer", "trash", "restore", "purge", "set", "set-many", "unset", "unset-many"];
const HYDRATION_KINDS = ["folder-page", "exact-nodes", "ancestry", "exact-settings", "setting-namespace"];
const CONFLICT_CATEGORIES = ["name", "parent", "lifecycle", "position", "content", "setting", "delete-restore-purge"];

describe("web2-sync-v1 corpus", () => {
  test("freezes protocol, schema, browser namespaces, and chunk size", () => {
    expect(corpus.schemaVersion).toBe(WEB2_SCHEMA_VERSION);
    expect(corpus.protocol).toBe(WEB2_SYNC_PROTOCOL);
    expect(corpus.constants).toEqual({ indexedDbPrefix: WEB2_INDEXED_DB_PREFIX, opfsPrefix: WEB2_OPFS_PREFIX, chunkSize: WEB2_CHUNK_SIZE });
    expect(SETTING_NAMESPACES).toEqual(["desktop-grid", "wallpaper", "editor", "file-templates", "widgets", "icon-groups", "theme-selection", "custom-themes"]);
    for (const namespace of ["workspace-directory", "shell", "file-associations", "handler-preferences"]) expect(() => parseSettingNamespace(namespace), namespace).toThrow();
  });

  test("pins the authoritative corpus bytes", async () => {
    expect(await sha256Hex(corpusBytes)).toBe("4870c8a131a6cd997e507b559f3f128616d3963ae84e2a12289ebc5624dc620a");
  });

  test("runs every primitive case through production validators", () => {
    corpus.primitives.stableIds.forEach((item) => accepts(parseStableId, item));
    corpus.primitives.names.forEach((item) => accepts(parseCanonicalName, item));
    corpus.primitives.mimeTypes.forEach((item) => accepts(parseMimeType, item));
    corpus.primitives.nonNegativeIntegers.forEach((item) => accepts(parseNonNegativeSafeInteger, item));
    corpus.primitives.positions.forEach((item) => accepts(parsePosition, item));
    corpus.primitives.sha256.forEach((item) => accepts(parseSha256, item));
    const multibyte180 = corpus.primitives.names.find(({ name }) => name === "180 multibyte code points")!.value as string;
    const multibyte181 = corpus.primitives.names.find(({ name }) => name === "181 multibyte code points")!.value as string;
    expect([...multibyte180]).toHaveLength(180);
    expect(new TextEncoder().encode(multibyte180).byteLength).toBeGreaterThan(255);
    expect([...multibyte181]).toHaveLength(181);
    expect(() => parsePosition({ x: Number.NaN, y: 0 })).toThrow();
    expect(() => parsePosition({ x: Number.POSITIVE_INFINITY, y: 0 })).toThrow();
  });

  test("validates canonical manifests, bytes, and hashes", async () => {
    expect(corpus.manifests.valid.map(({ name }) => name)).toEqual(["empty", "short", "full", "multi-chunk", "repeated hash"]);
    for (const item of corpus.manifests.valid) {
      expect(() => parseManifest(item.value), item.name).not.toThrow();
      expect(new TextDecoder().decode(canonicalManifestBytes(item.value)), item.name).toBe(item.canonicalJson);
      expect(await canonicalManifestSha256(item.value), item.name).toBe(item.sha256);
    }
    for (const item of corpus.manifests.invalid) expect(() => parseManifest(item.value), item.name).toThrow();
  });

  test("validates every exhaustive operation and its affected identities", () => {
    const validKinds = new Set<string>();
    for (const item of corpus.operations.valid) {
      const operation = parseWorkspaceOperation(item.value);
      validKinds.add(operation.kind);
      expect(operationAffectedIdentities(operation), item.name).toEqual(item.affected);
    }
    expect([...validKinds].sort()).toEqual([...OPERATION_KINDS].sort());
    expect([...new Set(corpus.operations.invalid.map(({ kind }) => kind))].sort()).toEqual([...OPERATION_KINDS].sort());
    for (const item of corpus.operations.invalid) expect(() => parseWorkspaceOperation(item.value), item.name).toThrow();
  });

  test("validates every bounded hydration target", () => {
    const validKinds = new Set(corpus.hydrationTargets.valid.map((item) => parseHydrationTarget(item.value).kind));
    expect([...validKinds].sort()).toEqual([...HYDRATION_KINDS].sort());
    expect([...new Set(corpus.hydrationTargets.invalid.map(({ kind }) => kind))].sort()).toEqual([...HYDRATION_KINDS].sort());
    for (const item of corpus.hydrationTargets.invalid) expect(() => parseHydrationTarget(item.value), item.name).toThrow();
  });

  test("validates bootstrap, hydration, pull, and push envelopes", () => {
    for (const item of corpus.bootstrap.valid) expect(() => parseBootstrap(item.value), item.name).not.toThrow();
    for (const item of corpus.bootstrap.invalid) expect(() => parseBootstrap(item.value), item.name).toThrow();
    for (const item of corpus.hydrationPages.valid) expect(() => parseHydrationPage(item.value), item.name).not.toThrow();
    for (const item of corpus.hydrationPages.invalid) expect(() => parseHydrationPage(item.value), item.name).toThrow();
    expect(new Set(corpus.pullResults.valid.map((item) => parsePullResult(item.value).kind))).toEqual(new Set(["operations", "reset"]));
    for (const item of corpus.pullResults.invalid) expect(() => parsePullResult(item.value), item.name).toThrow();
    expect(new Set(corpus.pushResults.valid.map((item) => parsePushResult(item.value).kind))).toEqual(new Set(["accepted", "rejected"]));
    for (const item of corpus.pushResults.invalid) expect(() => parsePushResult(item.value), item.name).toThrow();
    for (const item of corpus.pushRequests.valid) expect(() => parsePushRequest(item.value), item.name).not.toThrow();
    for (const item of corpus.pushRequests.invalid) expect(() => parsePushRequest(item.value), item.name).toThrow();
  });

  test("uses logical time then operation ID as the winner tuple", () => {
    for (const item of corpus.tupleOrdering) expect(winningOperationTuple(item.left, item.right), item.name).toBe(item.winner === "left" ? item.left : item.right);
  });

  test("applies the complete independent field conflict matrix", () => {
    expect([...new Set(corpus.conflictMatrix.valid.map(({ category }) => category))].sort()).toEqual([...CONFLICT_CATEGORIES].sort());
    for (const item of corpus.conflictMatrix.valid) expect(resolveFieldConflict(item.input), item.name).toEqual(item.expected);
    for (const item of corpus.conflictMatrix.invalid) expect(() => resolveFieldConflict(item.value), item.name).toThrow();
  });

  test("replays original receipts and rejects operation ID reuse", () => {
    for (const item of corpus.receipts.valid) expect(() => parseOperationReceipt(item.value), item.name).not.toThrow();
    for (const item of corpus.receipts.invalid) expect(() => parseOperationReceipt(item.value), item.name).toThrow();
    for (const item of corpus.receipts.replay) {
      const receipt = parseOperationReceipt(item.receipt);
      const result = replayOperationReceipt(receipt, item.operationId, item.inputHash);
      expect(result, item.name).toEqual(item.expected);
      if (item.inputHash === receipt.inputHash) expect(result, item.name).toBe(receipt.result);
      else expect(result).toMatchObject({ kind: "rejected", code: "operation-id-reuse" });
    }
  });

  test("validates chunk upload and download negotiation", async () => {
    for (const item of corpus.chunkNegotiation.uploadRequests.valid) await expect(parseChunkUploadRequest(item.value)).resolves.toBeDefined();
    for (const item of corpus.chunkNegotiation.uploadRequests.invalid) await expect(parseChunkUploadRequest(item.value)).rejects.toThrow();
    for (const item of corpus.chunkNegotiation.uploadResults.valid) await expect(parseChunkUploadResult(item.value, item.expectedManifest)).resolves.toBeDefined();
    for (const item of corpus.chunkNegotiation.uploadResults.invalid) await expect(parseChunkUploadResult(item.value, item.expectedManifest)).rejects.toThrow();
    for (const item of corpus.chunkNegotiation.downloadRequests.valid) expect(() => parseChunkDownloadRequest(item.value), item.name).not.toThrow();
    for (const item of corpus.chunkNegotiation.downloadRequests.invalid) expect(() => parseChunkDownloadRequest(item.value), item.name).toThrow();
    for (const item of corpus.chunkNegotiation.downloadResults.valid) await expect(parseChunkDownloadResult(item.value)).resolves.toBeDefined();
    for (const item of corpus.chunkNegotiation.downloadResults.invalid) await expect(parseChunkDownloadResult(item.value)).rejects.toThrow();
  });
});
