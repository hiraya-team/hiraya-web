import { MAX_FILE_CHUNK_BYTES } from "@hiraya/apps-contracts";
import type {
  AppPermission,
  DirectoryEntry,
  FileHandle,
  FileMetadata,
  FolderHandle,
  FolderMetadata,
  HirayaErrorCode,
  ServiceMethods,
} from "@hiraya/apps-contracts";
import type { DesktopStateSnapshot } from "../../domain/desktop-state";
import { ContentRevisionConflictError, type SaveFileOptions } from "../../domain/files";
import type { DesktopEntry, EntryPosition, FileEntry, FolderEntry } from "../../types";
import { CapabilityStore, type FileCapabilityHandle, type FileCapabilityOperation, type ResolvedFileCapability } from "./capability-store";

type Params<M extends keyof ServiceMethods> = ServiceMethods[M]["params"];
type Result<M extends keyof ServiceMethods> = ServiceMethods[M]["result"];

export type FileSyncFunctions = {
  readFile(id: string): Promise<Blob>;
  saveFile(id: string, content: Blob, options?: SaveFileOptions): Promise<FileEntry>;
  createFile(name: string, parentId: string | null, position: EntryPosition, content: Blob, mimeType?: string): Promise<FileEntry>;
  createFolder(name: string, parentId: string | null, position: EntryPosition): Promise<FolderEntry>;
  renameEntry(id: string, name: string): Promise<DesktopEntry>;
  moveEntry(id: string, parentId: string | null, position: EntryPosition): Promise<DesktopEntry>;
  deleteEntry(id: string): Promise<unknown>;
  deleteEntries(ids: string[]): Promise<unknown>;
};

export type FileServiceOptions = {
  appInstanceId: string;
  permissions: Iterable<AppPermission> | (() => Iterable<AppPermission>);
  capabilities: CapabilityStore;
  getSnapshot: () => DesktopStateSnapshot;
  sync: FileSyncFunctions;
  createPosition?: () => EntryPosition;
};

export class FileServiceError extends Error {
  constructor(readonly code: HirayaErrorCode, message: string) {
    super(message);
    this.name = "FileServiceError";
  }
}

export class FileService {
  private readonly createPosition: () => EntryPosition;
  private readonly writes = new Map<string, { handle: FileHandle; size: number; mimeType?: string; expectedRevision?: number; offset: number; chunks: ArrayBuffer[]; touchedAt: number }>();

  constructor(private readonly options: FileServiceOptions) {
    this.createPosition = options.createPosition ?? (() => ({ x: 0, y: 0 }));
  }

  async stat(params: Params<"files.stat">): Promise<Result<"files.stat">> {
    return this.protect(async () => {
      this.requirePermission("files:read");
      const capability = this.requireHandle(params.handle, "stat");
      return this.publicEntry(this.requireEntry(capability), capability);
    });
  }

  async read(params: Params<"files.read">): Promise<Result<"files.read">> {
    return this.protect(async () => {
      this.requirePermission("files:read");
      const capability = this.requireHandle(params.handle, "read", "file");
      const entry = this.requireEntry(capability, "file") as FileEntry;
      const blob = await this.options.sync.readFile(entry.id);
      return { data: await blob.arrayBuffer(), mimeType: entry.mimeType };
    });
  }

  async readChunk(params: Params<"files.readChunk">): Promise<Result<"files.readChunk">> {
    return this.protect(async () => {
      this.requirePermission("files:read");
      if (params.length > MAX_FILE_CHUNK_BYTES) throw new FileServiceError("INVALID_REQUEST", "The requested file chunk is too large.");
      const capability = this.requireHandle(params.handle, "read", "file");
      const entry = this.requireEntry(capability, "file") as FileEntry;
      if (params.offset > entry.size) throw new FileServiceError("INVALID_REQUEST", "The file chunk offset is beyond the end of the file.");
      const blob = await this.options.sync.readFile(entry.id);
      const data = await blob.slice(params.offset, Math.min(params.offset + params.length, entry.size)).arrayBuffer();
      return { data, mimeType: entry.mimeType, size: entry.size, contentRevision: this.snapshot().sync.contentRevisions[entry.id] ?? 0 };
    });
  }

  async write(params: Params<"files.write">): Promise<Result<"files.write">> {
    return this.protect(async () => {
      this.requirePermission("files:write");
      const capability = this.requireHandle(params.handle, "write", "file");
      const entry = this.requireEntry(capability, "file") as FileEntry;
      const saved = await this.options.sync.saveFile(entry.id, new Blob([params.data], { type: params.mimeType ?? entry.mimeType }), {
        mimeType: params.mimeType,
        expectedContentRevision: params.expectedRevision,
      });
      return this.fileMetadata(saved, capability);
    });
  }

  async beginWrite(params: Params<"files.beginWrite">): Promise<Result<"files.beginWrite">> {
    return this.protect(() => {
      this.requirePermission("files:write");
      this.cleanupWrites();
      const capability = this.requireHandle(params.handle, "write", "file");
      const entry = this.requireEntry(capability, "file") as FileEntry;
      const revision = this.snapshot().sync.contentRevisions[entry.id] ?? 0;
      if (params.expectedRevision !== undefined && params.expectedRevision !== revision) throw new FileServiceError("CONFLICT", "The file changed since it was last read.");
      if (this.writes.size >= MAX_STAGED_WRITE_SESSIONS || this.stagedBytes() + params.size > MAX_STAGED_WRITE_BYTES) throw new FileServiceError("QUOTA_EXCEEDED", "The app has too much file data staged in memory.");
      const uploadId = `upload_${crypto.randomUUID().replaceAll("-", "")}`;
      this.writes.set(uploadId, { handle: params.handle, size: params.size, mimeType: params.mimeType, expectedRevision: params.expectedRevision ?? revision, offset: 0, chunks: [], touchedAt: Date.now() });
      return { uploadId, chunkSize: MAX_FILE_CHUNK_BYTES };
    });
  }

  async writeChunk(params: Params<"files.writeChunk">): Promise<void> {
    return this.protect(() => {
      this.requirePermission("files:write");
      const write = this.requireWrite(params.uploadId);
      if (params.data.byteLength > MAX_FILE_CHUNK_BYTES || params.offset !== write.offset || params.data.byteLength === 0 || write.offset + params.data.byteLength > write.size) {
        throw new FileServiceError("INVALID_REQUEST", "File chunks must be complete and written in order.");
      }
      write.chunks.push(params.data);
      write.offset += params.data.byteLength;
      write.touchedAt = Date.now();
    });
  }

  async commitWrite(params: Params<"files.commitWrite">): Promise<Result<"files.commitWrite">> {
    return this.protect(async () => {
      this.requirePermission("files:write");
      const write = this.requireWrite(params.uploadId);
      if (write.offset !== write.size) throw new FileServiceError("INVALID_REQUEST", "The staged file is incomplete.");
      const capability = this.requireHandle(write.handle, "write", "file");
      const entry = this.requireEntry(capability, "file") as FileEntry;
      try {
        const saved = await this.options.sync.saveFile(entry.id, new Blob(write.chunks, { type: write.mimeType ?? entry.mimeType }), {
          mimeType: write.mimeType,
          expectedContentRevision: write.expectedRevision,
        });
        return this.fileMetadata(saved, capability);
      } finally {
        this.writes.delete(params.uploadId);
      }
    });
  }

  async abortWrite(params: Params<"files.abortWrite">): Promise<void> {
    return this.protect(() => {
      this.requirePermission("files:write");
      this.cleanupWrites();
      if (!this.writes.delete(params.uploadId)) throw new FileServiceError("NOT_FOUND", "The file write session is unavailable.");
    });
  }

  async resolve(params: Params<"files.resolve">): Promise<Result<"files.resolve">> {
    return this.protect(() => {
      this.requirePermission("files:read");
      const source = this.requireHandle(params.handle, "read");
      if (source.kind !== "folder") throw new FileServiceError("PERMISSION_DENIED", "Relative paths require access to a folder.");
      const sourceEntry = source.entryId === null ? null : this.requireEntry(source, "folder") as FolderEntry;
      const entries = this.snapshot().entries;
      let parentId = sourceEntry?.id ?? null;
      let target: DesktopEntry | undefined = sourceEntry ?? undefined;
      const parts = params.path.split("/");
      for (const [index, part] of parts.entries()) {
        if (part === ".") {
          target = parentId === null ? undefined : entries.find((entry) => entry.id === parentId && entry.kind === "folder");
          continue;
        }
        if (part === "..") {
          if (parentId === source.scopeEntryId) throw new FileServiceError("NOT_FOUND", "The relative file is unavailable.");
          const parent = parentId === null ? undefined : entries.find((entry) => entry.id === parentId && entry.kind === "folder");
          parentId = parent?.parentId ?? null;
          target = parentId === null ? undefined : entries.find((entry) => entry.id === parentId && entry.kind === "folder");
          continue;
        }
        target = entries.find((entry) => entry.parentId === parentId && entry.name === part);
        if (!target) throw new FileServiceError("NOT_FOUND", "The relative file is unavailable.");
        if (target.kind === "file" && index < parts.length - 1) throw new FileServiceError("NOT_FOUND", "The relative file is unavailable.");
        parentId = target.kind === "folder" ? target.id : target.parentId;
      }
      if (!target) throw new FileServiceError("NOT_FOUND", "The relative file is unavailable.");
      if (!this.inScope(target.id, source.scopeEntryId)) throw new FileServiceError("NOT_FOUND", "The relative file is unavailable.");
      const handle = this.options.capabilities.grantResolved(this.options.appInstanceId, params.handle, target.kind, target.id);
      return this.publicEntry(target, { handle, kind: target.kind, entryId: target.id, scopeEntryId: target.id, operations: source.operations });
    });
  }

  changedHandles(entryIds: Iterable<string>): (FileHandle | FolderHandle)[] {
    return this.options.capabilities.findAll(this.options.appInstanceId, new Set(entryIds));
  }

  changedPayload(entryIds: Iterable<string>): { handles: (FileHandle | FolderHandle)[] } {
    return { handles: this.changedHandles(entryIds) };
  }

  close(): void {
    this.writes.clear();
  }

  entryForHost(handle: FileCapabilityHandle, operation: FileCapabilityOperation = "stat"): DesktopEntry {
    return this.requireEntry(this.requireHandle(handle, operation));
  }

  folderIdForHost(handle: FolderHandle | null, operation: FileCapabilityOperation): string | null {
    const capability = handle === null ? this.requireRoot(operation) : this.requireHandle(handle, operation, "folder");
    if (capability.entryId !== null) this.requireEntry(capability, "folder");
    return capability.entryId;
  }

  async list(params: Params<"files.list">): Promise<Result<"files.list">> {
    return this.protect(async () => {
      this.requirePermission("files:read");
      const capability = params.folder === null
        ? this.requireRoot("list")
        : this.requireHandle(params.folder, "list", "folder");
      if (capability.entryId !== null) this.requireEntry(capability, "folder");
      return this.snapshot().entries.filter((entry) => entry.parentId === capability.entryId).map((entry) => {
        const handle = this.options.capabilities.derive(this.options.appInstanceId, capability.handle, entry.kind, entry.id);
        return this.publicEntry(entry, { ...capability, handle, kind: entry.kind, entryId: entry.id });
      });
    });
  }

  async createFile(params: Params<"files.createFile">): Promise<Result<"files.createFile">> {
    return this.protect(async () => {
      this.requirePermission("files:write");
      const parent = this.parentCapability(params.parent, "create");
      const blob = new Blob([params.data ?? new ArrayBuffer(0)], { type: params.mimeType ?? "application/octet-stream" });
      const entry = await this.options.sync.createFile(params.name, parent.entryId, this.createPosition(), blob, params.mimeType);
      const handle = this.options.capabilities.derive(this.options.appInstanceId, parent.handle, "file", entry.id) as FileHandle;
      return this.fileMetadata(entry, { ...parent, handle, kind: "file", entryId: entry.id });
    });
  }

  async createFolder(params: Params<"files.createFolder">): Promise<Result<"files.createFolder">> {
    return this.protect(async () => {
      this.requirePermission("files:write");
      const parent = this.parentCapability(params.parent, "create");
      const entry = await this.options.sync.createFolder(params.name, parent.entryId, this.createPosition());
      const handle = this.options.capabilities.derive(this.options.appInstanceId, parent.handle, "folder", entry.id) as FolderHandle;
      return this.folderMetadata(entry, { ...parent, handle, kind: "folder", entryId: entry.id });
    });
  }

  async rename(params: Params<"files.rename">): Promise<Result<"files.rename">> {
    return this.mutateEntry(params.handle, "rename", (entry) => this.options.sync.renameEntry(entry.id, params.name));
  }

  async move(params: Params<"files.move">): Promise<Result<"files.move">> {
    return this.protect(async () => {
      this.requirePermission("files:write");
      const capability = this.requireHandle(params.handle, "move");
      const entry = this.requireEntry(capability);
      const parent = this.parentCapability(params.parent, "create");
      const moved = await this.options.sync.moveEntry(entry.id, parent.entryId, entry.position);
      return this.publicEntry(moved, capability);
    });
  }

  async delete(params: Params<"files.delete">): Promise<void> {
    return this.protect(async () => {
      this.requirePermission("files:write");
      const capability = this.requireHandle(params.handle, "delete");
      const entry = this.requireEntry(capability);
      if (entry.kind === "folder" && this.snapshot().entries.some((candidate) => candidate.parentId === entry.id) && !params.recursive) {
        throw new FileServiceError("CONFLICT", "The folder is not empty.");
      }
      await this.options.sync.deleteEntry(entry.id);
      this.options.capabilities.revoke(params.handle);
    });
  }

  async deleteMany(params: Params<"files.deleteMany">): Promise<void> {
    return this.protect(async () => {
      this.requirePermission("files:write");
      // Resolve every capability and recursive constraint before the single host mutation.
      const selected = params.handles.map((handle) => ({ handle, entry: this.requireEntry(this.requireHandle(handle, "delete")) }));
      const snapshot = this.snapshot();
      if (!params.recursive && selected.some(({ entry }) => entry.kind === "folder" && snapshot.entries.some((candidate) => candidate.parentId === entry.id))) {
        throw new FileServiceError("CONFLICT", "A selected folder is not empty.");
      }
      await this.options.sync.deleteEntries(selected.map(({ entry }) => entry.id));
      for (const { handle } of selected) this.options.capabilities.revoke(handle);
    });
  }

  private async mutateEntry(handle: FileCapabilityHandle, operation: FileCapabilityOperation, mutation: (entry: DesktopEntry) => Promise<DesktopEntry>) {
    return this.protect(async () => {
      this.requirePermission("files:write");
      const capability = this.requireHandle(handle, operation);
      return this.publicEntry(await mutation(this.requireEntry(capability)), capability);
    });
  }

  private requireWrite(uploadId: string) {
    this.cleanupWrites();
    const write = this.writes.get(uploadId);
    if (!write) throw new FileServiceError("NOT_FOUND", "The file write session is unavailable.");
    return write;
  }

  private stagedBytes() {
    let bytes = 0;
    for (const write of this.writes.values()) bytes += write.size;
    return bytes;
  }

  private cleanupWrites(now = Date.now()) {
    for (const [id, write] of this.writes) if (now - write.touchedAt >= STAGED_WRITE_EXPIRY_MS) this.writes.delete(id);
  }

  private parentCapability(handle: FolderHandle | null, operation: FileCapabilityOperation) {
    const capability = handle === null ? this.requireRoot(operation) : this.requireHandle(handle, operation, "folder");
    if (capability.entryId !== null) this.requireEntry(capability, "folder");
    return capability;
  }

  private requireRoot(operation: FileCapabilityOperation) {
    const handle = this.options.capabilities.find(this.options.appInstanceId, null, "folder", operation);
    if (!handle) throw new FileServiceError("PERMISSION_DENIED", "Access to that location was not granted.");
    return this.requireHandle(handle, operation, "folder");
  }

  private requireHandle(handle: FileCapabilityHandle, operation: FileCapabilityOperation, kind?: "file" | "folder") {
    const granted = this.options.capabilities.inspect(this.options.appInstanceId, handle, kind);
    if (!granted) throw new FileServiceError("NOT_FOUND", "The file handle is unavailable.");
    const capability = this.options.capabilities.resolve(this.options.appInstanceId, handle, operation, kind);
    if (!capability) throw new FileServiceError("PERMISSION_DENIED", "The handle was not granted for this operation.");
    return capability;
  }

  private requireEntry(capability: ResolvedFileCapability, kind?: "file" | "folder") {
    const entry = capability.entryId === null ? undefined : this.snapshot().entries.find((candidate) => candidate.id === capability.entryId);
    if (!entry || entry.kind !== capability.kind || kind && entry.kind !== kind || !this.inScope(entry.id, capability.scopeEntryId)) {
      throw new FileServiceError("NOT_FOUND", "The file handle is unavailable.");
    }
    return entry;
  }

  private inScope(entryId: string, scopeEntryId: string | null) {
    if (scopeEntryId === null) return true;
    const entries = this.snapshot().entries;
    let current = entries.find((entry) => entry.id === entryId);
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      if (current.id === scopeEntryId) return true;
      seen.add(current.id);
      current = current.parentId === null ? undefined : entries.find((entry) => entry.id === current!.parentId);
    }
    return false;
  }

  private publicEntry(entry: DesktopEntry, capability: ResolvedFileCapability): DirectoryEntry {
    return entry.kind === "file"
      ? { kind: "file", metadata: this.fileMetadata(entry, capability) }
      : { kind: "folder", metadata: this.folderMetadata(entry, capability) };
  }

  private fileMetadata(entry: FileEntry, capability: ResolvedFileCapability): FileMetadata {
    return {
      handle: capability.handle as FileHandle,
      name: entry.name,
      mimeType: entry.mimeType,
      size: entry.size,
      modifiedAt: entry.modifiedAt,
      parent: this.parentHandle(entry.parentId, capability),
      contentRevision: this.snapshot().sync.contentRevisions[entry.id] ?? 0,
    };
  }

  private folderMetadata(entry: FolderEntry, capability: ResolvedFileCapability): FolderMetadata {
    return { handle: capability.handle as FolderHandle, name: entry.name, modifiedAt: entry.modifiedAt, parent: this.parentHandle(entry.parentId, capability) };
  }

  private parentHandle(parentId: string | null, capability: ResolvedFileCapability) {
    if (parentId === null) return null;
    const existing = this.options.capabilities.find(this.options.appInstanceId, parentId, "folder", "stat");
    if (existing) return existing as FolderHandle;
    if (!this.inScope(parentId, capability.scopeEntryId)) return null;
    return this.options.capabilities.derive(this.options.appInstanceId, capability.handle, "folder", parentId) as FolderHandle;
  }

  private requirePermission(permission: AppPermission) {
    const permissions = typeof this.options.permissions === "function" ? this.options.permissions() : this.options.permissions;
    if (!new Set(permissions).has(permission)) throw new FileServiceError("PERMISSION_DENIED", "The app does not have permission for this operation.");
  }

  private snapshot() {
    return this.options.getSnapshot();
  }

  private async protect<T>(operation: () => Promise<T> | T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof FileServiceError) throw error;
      if (error instanceof ContentRevisionConflictError) throw new FileServiceError("CONFLICT", "The file changed since it was last read.");
      if (error instanceof DOMException && error.name === "QuotaExceededError") throw new FileServiceError("QUOTA_EXCEEDED", "There is not enough storage space.");
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("already exists") || message.includes("same name")) throw new FileServiceError("ALREADY_EXISTS", "An item with that name already exists.");
      if (message.includes("invalid") || message.includes("name") && message.includes("must")) throw new FileServiceError("INVALID_REQUEST", "The file request is invalid.");
      if (message.includes("offline") || message.includes("not available offline")) throw new FileServiceError("OFFLINE", "The file is unavailable offline.");
      if (message.includes("no longer exists") || message.includes("not found")) throw new FileServiceError("NOT_FOUND", "The file handle is unavailable.");
      throw new FileServiceError("INTERNAL", "The file operation failed.");
    }
  }
}

export const MAX_STAGED_WRITE_SESSIONS = 4;
export const MAX_STAGED_WRITE_BYTES = 32 * 1024 * 1024;
export const STAGED_WRITE_EXPIRY_MS = 2 * 60 * 1000;
