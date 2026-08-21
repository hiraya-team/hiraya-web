import { parseStableId, sha256Hex } from "./ids";
export { parseStableId, sha256Hex, storageNamespaceHash } from "./ids";

/** Defines the Web2 schema version. */
export const WEB2_SCHEMA_VERSION = 1 as const;
/** Defines the Web2 IndexedDB prefix. */
export const WEB2_INDEXED_DB_PREFIX = "hiraya-web2-v1-" as const;
/** Defines the Web2 OPFS prefix. */
export const WEB2_OPFS_PREFIX = ".hiraya-web2-" as const;
/** Defines the Web2 chunk size. */
export const WEB2_CHUNK_SIZE = 1024 * 1024;
/** Defines the maximum Web2 batch size. */
export const WEB2_MAX_BATCH_ITEMS = 256;
/** Defines the maximum Web2 ancestry depth. */
export const WEB2_MAX_ANCESTRY_DEPTH = 64;

/** Matches a lowercase SHA-256 digest. */
const SHA256 = /^[0-9a-f]{64}$/;
/** Matches the expected MIME token. */
const MIME_TOKEN = "[!#$%&'*+.^_`|~\\w-]+";
/** Matches the expected MIME type. */
const MIME_TYPE = new RegExp(`^${MIME_TOKEN}/${MIME_TOKEN}(?:\\s*;\\s*${MIME_TOKEN}\\s*=\\s*(?:${MIME_TOKEN}|"(?:[^"\\\\]|\\\\.)*"))*\\s*$`);
/** Defines the MIME parameter name. */
const MIME_PARAMETER_NAME = new RegExp(`;\\s*(${MIME_TOKEN})\\s*=`, "g");
/** Defines the setting key. */
const SETTING_KEY = /^[a-z0-9](?:[a-z0-9._-]{0,127})$/;

/** Defines the setting namespaces. */
export const SETTING_NAMESPACES = [
  "desktop-grid",
  "wallpaper",
  "editor",
  "file-templates",
  "widgets",
  "icon-groups",
  "theme-selection",
  "custom-themes",
] as const;
/** Lists supported Web2 bootstrap setting keys. */
export const WEB2_BOOTSTRAP_SETTING_KEYS = ["auto-arrange-icons", "grid-size", "snap-to-grid"] as const;

export type SettingNamespace = typeof SETTING_NAMESPACES[number];
export type DesktopGridSettings = { autoArrangeIcons: boolean; snapToGrid: boolean; gridSize: 12 | 24 | 36 | 48 };
/** Defines the default desktop grid settings. */
export const DEFAULT_DESKTOP_GRID_SETTINGS: DesktopGridSettings = { autoArrangeIcons: true, snapToGrid: false, gridSize: 24 };
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type Position = { x: number; y: number };
export type ChunkRef = { hash: string; size: number };
export type Manifest = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  size: number;
  chunkSize: typeof WEB2_CHUNK_SIZE;
  chunks: ChunkRef[];
};
export type OperationTuple = { logicalTime: number; operationId: string };
export type ConflictWrite<T> = { value: T; tuple: OperationTuple };
export type LifecycleState = "active" | "trashed" | "purged";
export type ContentConflictValue = { mimeType: string; size: number; manifestHash: string };
export type SettingConflictValue = { deleted: false; value: JsonValue } | { deleted: true };
export type FieldConflict =
  | { category: "name"; current: ConflictWrite<string>; incoming: ConflictWrite<string> }
  | { category: "parent"; current: ConflictWrite<string | null>; incoming: ConflictWrite<string | null> }
  | { category: "lifecycle"; current: ConflictWrite<LifecycleState>; incoming: ConflictWrite<LifecycleState> }
  | { category: "position"; current: ConflictWrite<Position>; incoming: ConflictWrite<Position> }
  | { category: "content"; lifecycle: LifecycleState; current: ConflictWrite<ContentConflictValue>; incoming: ConflictWrite<ContentConflictValue> }
  | { category: "setting"; current: ConflictWrite<SettingConflictValue>; incoming: ConflictWrite<SettingConflictValue> }
  | { category: "delete-restore-purge"; current: ConflictWrite<LifecycleState>; incoming: ConflictWrite<LifecycleState> };
export type NodeLifecycle =
  | { kind: "active" }
  | { kind: "trashed"; trashedAt: number; originalParentId: string | null };
export type NodeFieldTuples = {
  name: OperationTuple;
  parent: OperationTuple;
  lifecycle: OperationTuple;
  position: OperationTuple;
  content: OperationTuple | null;
};
type NodeBase = {
  workspaceId: string;
  id: string;
  name: string;
  parentId: string | null;
  lifecycle: NodeLifecycle;
  position: Position;
  createdAt: number;
  modifiedAt: number;
  fieldTuples: NodeFieldTuples;
};
export type Node =
  | NodeBase & { kind: "folder" }
  | NodeBase & { kind: "file"; mimeType: string; size: number; manifestHash: string };
export type PurgeTombstone = { workspaceId: string; id: string; purged: true; logicalTime: number; operationId: string };
export type NodeRecord = Node | PurgeTombstone;
type SettingBase = {
  workspaceId: string;
  namespace: SettingNamespace;
  key: string;
  logicalTime: number;
  operationId: string;
};
export type Setting = SettingBase & ({ deleted: false; value: JsonValue } | { deleted: true });
export type ActiveSetting = Extract<Setting, { deleted: false }>;

/** Reports whether a value is a plain record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates exact keys. */
export function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], message = "A value has an unsupported shape.") {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) throw new Error(message);
}

/** Parses and validates a canonical entry name. */
export function parseCanonicalName(value: unknown, message = "A name is invalid.") {
  if (typeof value !== "string" || !value || value !== value.trim() || value === "." || value === ".." || value.includes("/") || value.includes("\\") || [...value].length > 180 || [...value].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point < 32 || point === 127;
  })) throw new Error(message);
  return value;
}

/** Reports whether a key stores a canonical entry name. */
export function canonicalNameKey(name: string) {
  return name.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

/** Parses and validates MIME type. */
export function parseMimeType(value: unknown, message = "A MIME type is invalid.") {
  if (typeof value !== "string" || !value || value.length > 255 || value !== value.trim() || !MIME_TYPE.test(value) || [...value].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point < 32 || point === 127;
  })) throw new Error(message);
  const parameters = new Set<string>();
  MIME_PARAMETER_NAME.lastIndex = 0;
  for (let match = MIME_PARAMETER_NAME.exec(value); match; match = MIME_PARAMETER_NAME.exec(value)) {
    const name = match[1]!.toLowerCase();
    if (parameters.has(name)) throw new Error(message);
    parameters.add(name);
  }
  return value;
}

/** Parses and validates a non-negative safe integer. */
export function parseNonNegativeSafeInteger(value: unknown, message = "A number must be a nonnegative safe integer.") {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(message);
  return Number(value);
}

/** Parses and validates positive safe integer. */
export function parsePositiveSafeInteger(value: unknown, message = "A number must be a positive safe integer.") {
  const result = parseNonNegativeSafeInteger(value, message);
  if (result === 0) throw new Error(message);
  return result;
}

/** Parses and validates finite number. */
export function parseFiniteNumber(value: unknown, message = "A number must be finite.") {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(message);
  return value;
}

/** Parses and validates position. */
export function parsePosition(value: unknown): Position {
  if (!isRecord(value)) throw new Error("A position has an unsupported shape.");
  assertExactKeys(value, ["x", "y"], "A position has an unsupported shape.");
  return { x: parseFiniteNumber(value.x, "A position is invalid."), y: parseFiniteNumber(value.y, "A position is invalid.") };
}

/** Parses and validates a SHA-256 digest. */
export function parseSha256(value: unknown, message = "A SHA-256 digest is invalid.") {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(message);
  return value;
}

/** Parses and validates setting namespace. */
export function parseSettingNamespace(value: unknown): SettingNamespace {
  if (!SETTING_NAMESPACES.includes(value as SettingNamespace)) throw new Error("A setting namespace is invalid.");
  return value as SettingNamespace;
}

/** Parses and validates setting key. */
export function parseSettingKey(value: unknown) {
  if (typeof value !== "string" || !SETTING_KEY.test(value)) throw new Error("A setting key is invalid.");
  return value;
}

/** Parses and validates setting key for namespace. */
export function parseSettingKeyForNamespace(namespaceValue: unknown, keyValue: unknown) {
  const namespace = parseSettingNamespace(namespaceValue);
  const key = parseSettingKey(keyValue);
  if (namespace === "desktop-grid" && key !== "auto-arrange-icons" && key !== "snap-to-grid" && key !== "grid-size") throw new Error("A desktop grid setting key is invalid.");
  return { namespace, key };
}

/** Parses and validates a JSON value at a labeled path. */
function parseJsonValueAt(value: unknown, depth: number): JsonValue {
  if (depth > 32) throw new Error("A setting value is too deeply nested.");
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("A setting value is not valid JSON.");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => parseJsonValueAt(item, depth + 1));
  if (!isRecord(value)) throw new Error("A setting value is not valid JSON.");
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, parseJsonValueAt(item, depth + 1)]));
}

/** Parses and validates setting value. */
export function parseSettingValue(value: unknown): JsonValue {
  const result = parseJsonValueAt(value, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 64 * 1024) throw new Error("A setting value is too large.");
  return result;
}

/** Parses and validates workspace setting. */
export function parseWorkspaceSetting(namespaceValue: unknown, keyValue: unknown, value: unknown) {
  const { namespace, key } = parseSettingKeyForNamespace(namespaceValue, keyValue);
  const parsed = parseSettingValue(value);
  if (namespace === "desktop-grid") {
    if ((key === "auto-arrange-icons" || key === "snap-to-grid") && typeof parsed !== "boolean") throw new Error("A desktop grid boolean setting is invalid.");
    if (key === "grid-size" && parsed !== 12 && parsed !== 24 && parsed !== 36 && parsed !== 48) throw new Error("A desktop grid size setting is invalid.");
  }
  return { namespace, key, value: parsed };
}

/** Parses and validates desktop grid settings. */
export function parseDesktopGridSettings(value: unknown): DesktopGridSettings {
  if (!isRecord(value)) throw new Error("Desktop grid settings have an unsupported shape.");
  assertExactKeys(value, ["autoArrangeIcons", "snapToGrid", "gridSize"], "Desktop grid settings have an unsupported shape.");
  const autoArrangeIcons = parseWorkspaceSetting("desktop-grid", "auto-arrange-icons", value.autoArrangeIcons).value;
  const snapToGrid = parseWorkspaceSetting("desktop-grid", "snap-to-grid", value.snapToGrid).value;
  const gridSize = parseWorkspaceSetting("desktop-grid", "grid-size", value.gridSize).value;
  return { autoArrangeIcons: autoArrangeIcons as boolean, snapToGrid: snapToGrid as boolean, gridSize: gridSize as DesktopGridSettings["gridSize"] };
}

/** Parses and validates node lifecycle. */
export function parseNodeLifecycle(value: unknown): NodeLifecycle {
  if (!isRecord(value)) throw new Error("A node lifecycle has an unsupported shape.");
  if (value.kind === "active") {
    assertExactKeys(value, ["kind"], "A node lifecycle has an unsupported shape.");
    return { kind: "active" };
  }
  if (value.kind !== "trashed") throw new Error("A node lifecycle kind is invalid.");
  assertExactKeys(value, ["kind", "trashedAt", "originalParentId"], "A node lifecycle has an unsupported shape.");
  return {
    kind: "trashed",
    trashedAt: parseNonNegativeSafeInteger(value.trashedAt, "A Trash time is invalid."),
    originalParentId: value.originalParentId === null ? null : parseStableId(value.originalParentId, "An original parent ID is invalid."),
  };
}

/** Parses and validates node field tuples. */
function parseNodeFieldTuples(value: unknown): NodeFieldTuples {
  if (!isRecord(value)) throw new Error("Node field tuples have an unsupported shape.");
  assertExactKeys(value, ["name", "parent", "lifecycle", "position", "content"], "Node field tuples have an unsupported shape.");
  return {
    name: parseOperationTuple(value.name),
    parent: parseOperationTuple(value.parent),
    lifecycle: parseOperationTuple(value.lifecycle),
    position: parseOperationTuple(value.position),
    content: value.content === null ? null : parseOperationTuple(value.content),
  };
}

/** Parses and validates node. */
export function parseNode(value: unknown): Node {
  if (!isRecord(value) || value.kind !== "folder" && value.kind !== "file") throw new Error("A node has an unsupported shape.");
  const baseKeys = ["workspaceId", "id", "kind", "name", "parentId", "lifecycle", "position", "createdAt", "modifiedAt", "fieldTuples"];
  assertExactKeys(value, value.kind === "file" ? [...baseKeys, "mimeType", "size", "manifestHash"] : baseKeys, "A node has an unsupported shape.");
  const base: NodeBase = {
    workspaceId: parseStableId(value.workspaceId, "A node workspace ID is invalid."),
    id: parseStableId(value.id, "A node ID is invalid."),
    name: parseCanonicalName(value.name, "A node name is invalid."),
    parentId: value.parentId === null ? null : parseStableId(value.parentId, "A node parent ID is invalid."),
    lifecycle: parseNodeLifecycle(value.lifecycle),
    position: parsePosition(value.position),
    createdAt: parseNonNegativeSafeInteger(value.createdAt, "A node creation time is invalid."),
    modifiedAt: parseNonNegativeSafeInteger(value.modifiedAt, "A node modification time is invalid."),
    fieldTuples: parseNodeFieldTuples(value.fieldTuples),
  };
  if (base.parentId === base.id) throw new Error("A node cannot be its own parent.");
  if (value.kind === "folder") {
    if (base.fieldTuples.content !== null) throw new Error("A folder cannot have a content tuple.");
    return { ...base, kind: "folder" };
  }
  if (base.fieldTuples.content === null) throw new Error("A file requires a content tuple.");
  return {
    ...base,
    kind: "file",
    mimeType: parseMimeType(value.mimeType, "A node MIME type is invalid."),
    size: parseNonNegativeSafeInteger(value.size, "A node size is invalid."),
    manifestHash: parseSha256(value.manifestHash, "A node manifest hash is invalid."),
  };
}

/** Parses and validates purge tombstone. */
export function parsePurgeTombstone(value: unknown): PurgeTombstone {
  if (!isRecord(value)) throw new Error("A purge tombstone has an unsupported shape.");
  assertExactKeys(value, ["workspaceId", "id", "purged", "logicalTime", "operationId"], "A purge tombstone has an unsupported shape.");
  if (value.purged !== true) throw new Error("A purge tombstone has invalid metadata.");
  return {
    workspaceId: parseStableId(value.workspaceId, "A purge tombstone workspace ID is invalid."),
    id: parseStableId(value.id, "A purge tombstone node ID is invalid."),
    purged: true,
    logicalTime: parseNonNegativeSafeInteger(value.logicalTime, "A purge tombstone logical time is invalid."),
    operationId: parseStableId(value.operationId, "A purge tombstone operation ID is invalid."),
  };
}

/** Parses and validates node record. */
export function parseNodeRecord(value: unknown): NodeRecord {
  return isRecord(value) && "purged" in value ? parsePurgeTombstone(value) : parseNode(value);
}

/** Parses and validates setting. */
export function parseSetting(value: unknown): Setting {
  if (!isRecord(value)) throw new Error("A setting has an unsupported shape.");
  if (typeof value.deleted !== "boolean") throw new Error("A setting has an unsupported shape.");
  assertExactKeys(value, value.deleted ? ["workspaceId", "namespace", "key", "deleted", "logicalTime", "operationId"] : ["workspaceId", "namespace", "key", "deleted", "value", "logicalTime", "operationId"], "A setting has an unsupported shape.");
  const identity = parseSettingKeyForNamespace(value.namespace, value.key);
  const base = {
    workspaceId: parseStableId(value.workspaceId, "A setting workspace ID is invalid."),
    ...identity,
    logicalTime: parseNonNegativeSafeInteger(value.logicalTime, "A setting logical time is invalid."),
    operationId: parseStableId(value.operationId, "A setting operation ID is invalid."),
  };
  if (value.deleted) return { ...base, deleted: true };
  return { ...base, deleted: false, value: parseWorkspaceSetting(identity.namespace, identity.key, value.value).value };
}

/** Parses and validates operation tuple. */
export function parseOperationTuple(value: unknown): OperationTuple {
  if (!isRecord(value)) throw new Error("An operation tuple has an unsupported shape.");
  assertExactKeys(value, ["logicalTime", "operationId"], "An operation tuple has an unsupported shape.");
  return {
    logicalTime: parseNonNegativeSafeInteger(value.logicalTime, "An operation logical time is invalid."),
    operationId: parseStableId(value.operationId, "An operation ID is invalid."),
  };
}

/** Compares operation tuples. */
export function compareOperationTuples(leftValue: unknown, rightValue: unknown) {
  const left = parseOperationTuple(leftValue);
  const right = parseOperationTuple(rightValue);
  if (left.logicalTime !== right.logicalTime) return left.logicalTime < right.logicalTime ? -1 : 1;
  return left.operationId === right.operationId ? 0 : left.operationId < right.operationId ? -1 : 1;
}

/** Returns winning operation tuple. */
export function winningOperationTuple<T extends OperationTuple>(left: T, right: T): T {
  return compareOperationTuples(left, right) >= 0 ? left : right;
}

/** Parses and validates conflict write. */
function parseConflictWrite<T>(value: unknown, parseValue: (candidate: unknown) => T): ConflictWrite<T> {
  if (!isRecord(value)) throw new Error("A conflict write has an unsupported shape.");
  assertExactKeys(value, ["value", "tuple"], "A conflict write has an unsupported shape.");
  return { value: parseValue(value.value), tuple: parseOperationTuple(value.tuple) };
}

/** Parses and validates lifecycle state. */
function parseLifecycleState(value: unknown): LifecycleState {
  if (value !== "active" && value !== "trashed" && value !== "purged") throw new Error("A lifecycle state is invalid.");
  return value;
}

/** Parses and validates content conflict value. */
function parseContentConflictValue(value: unknown): ContentConflictValue {
  if (!isRecord(value)) throw new Error("A content conflict value has an unsupported shape.");
  assertExactKeys(value, ["mimeType", "size", "manifestHash"], "A content conflict value has an unsupported shape.");
  return { mimeType: parseMimeType(value.mimeType), size: parseNonNegativeSafeInteger(value.size), manifestHash: parseSha256(value.manifestHash) };
}

/** Parses and validates setting conflict value. */
function parseSettingConflictValue(value: unknown): SettingConflictValue {
  if (!isRecord(value) || typeof value.deleted !== "boolean") throw new Error("A setting conflict value has an unsupported shape.");
  assertExactKeys(value, value.deleted ? ["deleted"] : ["deleted", "value"], "A setting conflict value has an unsupported shape.");
  return value.deleted ? { deleted: true } : { deleted: false, value: parseSettingValue(value.value) };
}

/** Parses and validates field conflict. */
function parseFieldConflict(value: unknown): FieldConflict {
  if (!isRecord(value) || typeof value.category !== "string") throw new Error("A field conflict has an unsupported shape.");
  const standardKeys = ["category", "current", "incoming"];
  switch (value.category) {
    case "name":
      assertExactKeys(value, standardKeys, "A name conflict has an unsupported shape.");
      return { category: "name", current: parseConflictWrite(value.current, parseCanonicalName), incoming: parseConflictWrite(value.incoming, parseCanonicalName) };
    case "parent": {
      assertExactKeys(value, standardKeys, "A parent conflict has an unsupported shape.");
      const parent = (candidate: unknown) => candidate === null ? null : parseStableId(candidate, "A conflict parent ID is invalid.");
      return { category: "parent", current: parseConflictWrite(value.current, parent), incoming: parseConflictWrite(value.incoming, parent) };
    }
    case "lifecycle":
      assertExactKeys(value, standardKeys, "A lifecycle conflict has an unsupported shape.");
      return { category: "lifecycle", current: parseConflictWrite(value.current, parseLifecycleState), incoming: parseConflictWrite(value.incoming, parseLifecycleState) };
    case "position":
      assertExactKeys(value, standardKeys, "A position conflict has an unsupported shape.");
      return { category: "position", current: parseConflictWrite(value.current, parsePosition), incoming: parseConflictWrite(value.incoming, parsePosition) };
    case "content":
      assertExactKeys(value, [...standardKeys, "lifecycle"], "A content conflict has an unsupported shape.");
      return { category: "content", lifecycle: parseLifecycleState(value.lifecycle), current: parseConflictWrite(value.current, parseContentConflictValue), incoming: parseConflictWrite(value.incoming, parseContentConflictValue) };
    case "setting":
      assertExactKeys(value, standardKeys, "A setting conflict has an unsupported shape.");
      return { category: "setting", current: parseConflictWrite(value.current, parseSettingConflictValue), incoming: parseConflictWrite(value.incoming, parseSettingConflictValue) };
    case "delete-restore-purge":
      assertExactKeys(value, standardKeys, "A delete/restore/purge conflict has an unsupported shape.");
      return { category: "delete-restore-purge", current: parseConflictWrite(value.current, parseLifecycleState), incoming: parseConflictWrite(value.incoming, parseLifecycleState) };
    default:
      throw new Error("A field conflict category is unsupported.");
  }
}

/** Resolves tuple write. */
function resolveTupleWrite<T>(current: ConflictWrite<T>, incoming: ConflictWrite<T>) {
  const winner = compareOperationTuples(incoming.tuple, current.tuple) > 0 ? "incoming" : "current";
  return { winner, ...(winner === "incoming" ? incoming : current) } as const;
}

/** Resolves lifecycle write. */
function resolveLifecycleWrite(current: ConflictWrite<LifecycleState>, incoming: ConflictWrite<LifecycleState>) {
  if (current.value === "purged" && incoming.value !== "purged") return { winner: "current", ...current } as const;
  if (incoming.value === "purged" && current.value !== "purged") return { winner: "incoming", ...incoming } as const;
  return resolveTupleWrite(current, incoming);
}

/** Resolves field conflict. */
export function resolveFieldConflict(value: unknown) {
  const conflict = parseFieldConflict(value);
  switch (conflict.category) {
    case "name": return resolveTupleWrite(conflict.current, conflict.incoming);
    case "parent": return resolveTupleWrite(conflict.current, conflict.incoming);
    case "lifecycle": return resolveLifecycleWrite(conflict.current, conflict.incoming);
    case "position": return resolveTupleWrite(conflict.current, conflict.incoming);
    case "content": return { ...resolveTupleWrite(conflict.current, conflict.incoming), lifecycle: conflict.lifecycle };
    case "setting": return resolveTupleWrite(conflict.current, conflict.incoming);
    case "delete-restore-purge": return resolveLifecycleWrite(conflict.current, conflict.incoming);
  }
}

/** Parses and validates manifest. */
export function parseManifest(value: unknown): Manifest {
  if (!isRecord(value)) throw new Error("A manifest has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "size", "chunkSize", "chunks"], "A manifest has an unsupported shape.");
  if (value.schemaVersion !== WEB2_SCHEMA_VERSION || value.chunkSize !== WEB2_CHUNK_SIZE || !Array.isArray(value.chunks)) throw new Error("A manifest has unsupported metadata.");
  const candidates = value.chunks;
  const size = parseNonNegativeSafeInteger(value.size, "A manifest size is invalid.");
  const hashSizes = new Map<string, number>();
  let total = 0;
  const chunks = candidates.map((candidate, index): ChunkRef => {
    if (!isRecord(candidate)) throw new Error("A manifest chunk has an unsupported shape.");
    assertExactKeys(candidate, ["hash", "size"], "A manifest chunk has an unsupported shape.");
    const hash = parseSha256(candidate.hash, "A manifest chunk hash is invalid.");
    const chunkSize = parsePositiveSafeInteger(candidate.size, "A manifest chunk size is invalid.");
    if (chunkSize > WEB2_CHUNK_SIZE || index < candidates.length - 1 && chunkSize !== WEB2_CHUNK_SIZE) throw new Error("A manifest chunk size is invalid.");
    const previousSize = hashSizes.get(hash);
	    if (previousSize !== undefined && previousSize !== chunkSize) throw new Error("A repeated manifest chunk has an inconsistent size.");
	    hashSizes.set(hash, chunkSize);
	    if (hashSizes.size > WEB2_MAX_BATCH_ITEMS) throw new Error("A manifest has too many unique chunks.");
    total += chunkSize;
    if (!Number.isSafeInteger(total)) throw new Error("A manifest size is invalid.");
    return { hash, size: chunkSize };
  });
  if (chunks.length === 0 && size !== 0 || chunks.length > 0 && size === 0 || total !== size) throw new Error("A manifest size does not match its chunks.");
  return { schemaVersion: WEB2_SCHEMA_VERSION, size, chunkSize: WEB2_CHUNK_SIZE, chunks };
}

/** Reports whether bytes use the canonical manifest encoding. */
export function canonicalManifestBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(parseManifest(value)));
}

/** Reports whether a digest matches the canonical manifest bytes. */
export function canonicalManifestSha256(value: unknown) {
  return sha256Hex(canonicalManifestBytes(value));
}
