import type { FileHandle, FolderHandle } from "@hiraya-team/apps-contracts";

export type FileCapabilityOperation = "stat" | "read" | "write" | "list" | "create" | "rename" | "move" | "delete";
export type FileCapabilityHandle = FileHandle | FolderHandle;

export type ResolvedFileCapability = {
  handle: FileCapabilityHandle;
  kind: "file" | "folder";
  entryId: string | null;
  scopeEntryId: string | null;
  operations: ReadonlySet<FileCapabilityOperation>;
};

type CapabilityRecord = ResolvedFileCapability & {
  appInstanceId: string;
  revoked: boolean;
};

/** Defines the default read-only operations for a file grant. */
const DEFAULT_FILE_OPERATIONS: readonly FileCapabilityOperation[] = ["stat", "read"];
/** Defines the default read-only operations for a folder grant. */
const DEFAULT_FOLDER_OPERATIONS: readonly FileCapabilityOperation[] = ["stat", "list"];

/** Issues and resolves opaque file capabilities for hosted app instances. */
export class CapabilityStore {
  private readonly records = new Map<FileCapabilityHandle, CapabilityRecord>();
  private readonly mutationAllowed = new Map<string, boolean>();

  /** Grants direct access to one file. */
  grantFile(appInstanceId: string, entryId: string, operations: Iterable<FileCapabilityOperation> = DEFAULT_FILE_OPERATIONS): FileHandle {
    return this.grant(appInstanceId, "file", entryId, entryId, operations) as FileHandle;
  }

  /** Grants a file while preserving an ancestor scope boundary. */
  grantScopedFile(appInstanceId: string, entryId: string, scopeEntryId: string | null, operations: Iterable<FileCapabilityOperation> = DEFAULT_FILE_OPERATIONS): FileHandle {
    return this.grant(appInstanceId, "file", entryId, scopeEntryId, operations) as FileHandle;
  }

  /** Grants access to a folder or desktop root. */
  grantFolder(appInstanceId: string, entryId: string | null, operations: Iterable<FileCapabilityOperation> = DEFAULT_FOLDER_OPERATIONS): FolderHandle {
    return this.grant(appInstanceId, "folder", entryId, entryId, operations) as FolderHandle;
  }

  /** Derives a child handle that retains its source scope and operations. */
  derive(appInstanceId: string, source: FileCapabilityHandle, kind: "file" | "folder", entryId: string): FileCapabilityHandle {
    const parent = this.lookup(appInstanceId, source);
    for (const record of this.records.values()) {
      if (!record.revoked && record.appInstanceId === appInstanceId && record.kind === kind && record.entryId === entryId && record.scopeEntryId === parent.scopeEntryId && sameOperations(record.operations, parent.operations)) return record.handle;
    }
    return this.grant(appInstanceId, kind, entryId, parent.scopeEntryId, parent.operations);
  }

  /** Grants a resolved target as the root of a new capability scope. */
  grantResolved(appInstanceId: string, source: FileCapabilityHandle, kind: "file" | "folder", entryId: string): FileCapabilityHandle {
    const parent = this.lookup(appInstanceId, source);
    return this.grant(appInstanceId, kind, entryId, entryId, parent.operations);
  }

  /** Resolves a handle when its owner, kind, and requested operation match. */
  resolve(appInstanceId: string, handle: FileCapabilityHandle, operation: FileCapabilityOperation, kind?: "file" | "folder"): ResolvedFileCapability | null {
    const record = this.inspect(appInstanceId, handle, kind);
    if (!record) return null;
    if (isMutation(operation) && this.mutationAllowed.get(appInstanceId) === false) return null;
    if (!record.operations.has(operation)) return null;
    return record;
  }

  /** Enables or disables mutating capabilities for an app instance. */
  setInstanceMutationAllowed(appInstanceId: string, allowed: boolean) {
    this.mutationAllowed.set(appInstanceId, allowed);
  }

  /** Inspects an active handle without requiring a specific operation. */
  inspect(appInstanceId: string, handle: FileCapabilityHandle, kind?: "file" | "folder"): ResolvedFileCapability | null {
    const record = this.records.get(handle);
    if (!record || record.revoked || record.appInstanceId !== appInstanceId || kind && record.kind !== kind) return null;
    return record;
  }

  /** Finds an existing handle for an entry and operation. */
  find(appInstanceId: string, entryId: string | null, kind: "file" | "folder", operation: FileCapabilityOperation): FileCapabilityHandle | null {
    for (const record of this.records.values()) {
      if (!record.revoked && record.appInstanceId === appInstanceId && record.entryId === entryId && record.kind === kind && record.operations.has(operation)) return record.handle;
    }
    return null;
  }

  /** Finds all active handles affected by a set of entry IDs. */
  findAll(appInstanceId: string, entryIds: ReadonlySet<string>): FileCapabilityHandle[] {
    const handles: FileCapabilityHandle[] = [];
    for (const record of this.records.values()) {
      if (!record.revoked && record.appInstanceId === appInstanceId && record.entryId !== null && entryIds.has(record.entryId)) handles.push(record.handle);
    }
    return handles;
  }

  /** Revokes one capability handle. */
  revoke(handle: FileCapabilityHandle) {
    const record = this.records.get(handle);
    if (record) record.revoked = true;
  }

  /** Revokes every capability and mutation override for an app instance. */
  revokeInstance(appInstanceId: string) {
    for (const record of this.records.values()) if (record.appInstanceId === appInstanceId) record.revoked = true;
    this.mutationAllowed.delete(appInstanceId);
  }

  /** Returns the active capability record owned by an app instance. */
  private lookup(appInstanceId: string, handle: FileCapabilityHandle) {
    const record = this.records.get(handle);
    if (!record || record.revoked || record.appInstanceId !== appInstanceId) throw new Error("Invalid file capability.");
    return record;
  }

  /** Creates and stores an opaque capability handle. */
  private grant(appInstanceId: string, kind: "file" | "folder", entryId: string | null, scopeEntryId: string | null, operations: Iterable<FileCapabilityOperation>) {
    if (!appInstanceId || kind === "file" && entryId === null) throw new Error("Invalid file capability grant.");
    const handle = `${kind}_${crypto.randomUUID().replaceAll("-", "")}` as FileCapabilityHandle;
    const record: CapabilityRecord = { handle, appInstanceId, kind, entryId, scopeEntryId, operations: new Set(operations), revoked: false };
    this.records.set(handle, record);
    return handle;
  }
}

/** Reports whether a capability operation changes desktop state. */
function isMutation(operation: FileCapabilityOperation) {
  return operation === "write" || operation === "create" || operation === "rename" || operation === "move" || operation === "delete";
}

/** Reports whether two capability operation sets are equal. */
function sameOperations(left: ReadonlySet<FileCapabilityOperation>, right: ReadonlySet<FileCapabilityOperation>) {
  return left.size === right.size && [...left].every((operation) => right.has(operation));
}
