import { HirayaSdkError, type DirectoryEntry, type FileHandle, type FolderHandle, type HirayaClient } from "@hiraya-team/apps-sdk";
import type { ShellEntry, ShellHost } from "./shell";

type Resolved = { path: string; entry: DirectoryEntry | null; handle: FolderHandle | FileHandle; parent: FolderHandle | null };

/** Implements the Hiraya file system. */
export class HirayaFileSystem implements ShellHost {
  /** Creates a hiraya file system instance. */
  constructor(private readonly hiraya: HirayaClient, private readonly root: FolderHandle) {}

  /** Lists the available entries. */
  async list(path: string, signal?: AbortSignal): Promise<ShellEntry[]> {
    const folder = await this.resolve(path, "folder", signal);
    return Promise.all((await this.hiraya.files.list(folder.handle as FolderHandle, { signal })).map((entry) => this.shellEntry(entry, join(folder.path, entry.metadata.name))));
  }

  /** Returns metadata for an entry. */
  async stat(path: string, signal?: AbortSignal): Promise<ShellEntry> {
    if (clean(path) === "/") return { path: "/", name: "/", kind: "folder", size: 0, modifiedAt: 0 };
    const resolved = await this.resolve(path, undefined, signal);
    return this.shellEntry(resolved.entry!, resolved.path);
  }

  /** Reads an entry's contents. */
  async read(path: string, signal?: AbortSignal): Promise<string> {
    const resolved = await this.resolve(path, "file", signal);
    const { data } = await this.hiraya.files.readAll(resolved.handle as FileHandle, { signal });
    return new TextDecoder().decode(data);
  }

  /** Writes an entry's contents. */
  async write(path: string, text: string, append: boolean, signal?: AbortSignal): Promise<void> {
    const normalized = clean(path);
    const bytes = new TextEncoder().encode(text);
    try {
      const resolved = await this.resolve(normalized, "file", signal);
      const metadata = resolved.entry!.metadata;
      const data = append ? concat(new Uint8Array((await this.hiraya.files.readAll(resolved.handle as FileHandle, { signal })).data), bytes) : bytes;
      await this.hiraya.files.writeAll(resolved.handle as FileHandle, data.buffer as ArrayBuffer, { signal, mimeType: "text/plain; charset=utf-8", expectedRevision: "contentRevision" in metadata ? metadata.contentRevision : undefined });
    } catch (error) {
      if (!(error instanceof HirayaSdkError) || error.code !== "NOT_FOUND") throw error;
      const { parent, name } = await this.parent(normalized, signal);
      await this.hiraya.files.createFile({ parent, name, data: bytes.buffer as ArrayBuffer, mimeType: "text/plain; charset=utf-8" }, { signal });
    }
  }

  /** Creates or updates a file entry. */
  async touch(path: string, signal?: AbortSignal): Promise<void> {
    try {
      await this.resolve(path, "file", signal);
    } catch (error) {
      if (!(error instanceof HirayaSdkError) || error.code !== "NOT_FOUND") throw error;
      const { parent, name } = await this.parent(path, signal);
      await this.hiraya.files.createFile({ parent, name }, { signal });
    }
  }

  /** Creates a directory entry. */
  async mkdir(path: string, signal?: AbortSignal): Promise<void> {
    const { parent, name } = await this.parent(path, signal);
    await this.hiraya.files.createFolder(parent, name, { signal });
  }

  /** Copies an entry. */
  async copy(source: string, destination: string, recursive: boolean, signal?: AbortSignal): Promise<void> {
    const from = await this.resolve(source, undefined, signal);
    let target = clean(destination);
    try { if ((await this.resolve(target, undefined, signal)).entry?.kind === "folder") target = join(target, from.entry!.metadata.name); } catch (error) { if (!(error instanceof HirayaSdkError) || error.code !== "NOT_FOUND") throw error; }
    if (from.entry!.kind === "folder") {
      if (!recursive) throw new Error("cp: folder requires -r");
      if (target === from.path || target.startsWith(`${from.path}/`)) throw new Error("cp: cannot copy a folder into itself");
      await this.mkdir(target, signal);
      for (const child of await this.list(from.path, signal)) await this.copy(child.path, join(target, child.name), true, signal);
      return;
    }
    const metadata = from.entry!.metadata;
    const { parent, name } = await this.parent(target, signal);
    const created = await this.hiraya.files.createFile({ parent, name, mimeType: metadata.mimeType }, { signal });
    if (!metadata.size) return;
    let uploadId: string | null = null;
    try {
      const write = await this.hiraya.files.beginWrite(created.handle, metadata.size, { signal, mimeType: metadata.mimeType, expectedRevision: created.contentRevision });
      uploadId = write.uploadId;
      for (let offset = 0; offset < metadata.size; offset += write.chunkSize) {
        const chunk = await this.hiraya.files.readChunk(from.handle as FileHandle, offset, Math.min(write.chunkSize, metadata.size - offset), { signal });
        await this.hiraya.files.writeChunk(write.uploadId, offset, chunk.data, { signal });
      }
      await this.hiraya.files.commitWrite(write.uploadId, { signal });
    } catch (error) {
      if (uploadId) await this.hiraya.files.abortWrite(uploadId).catch(() => undefined);
      await this.hiraya.files.delete(created.handle).catch(() => undefined);
      throw error;
    }
  }

  /** Moves an entry. */
  async move(source: string, destination: string, signal?: AbortSignal): Promise<void> {
    const from = await this.resolve(source, undefined, signal);
    let target = clean(destination);
    try { if ((await this.resolve(target, undefined, signal)).entry?.kind === "folder") target = join(target, from.entry!.metadata.name); } catch (error) { if (!(error instanceof HirayaSdkError) || error.code !== "NOT_FOUND") throw error; }
    const { parent, name } = await this.parent(target, signal);
    const sourceParentPath = from.path.slice(0, from.path.lastIndexOf("/")) || "/";
    const targetParentPath = target.slice(0, target.lastIndexOf("/")) || "/";
    if (sourceParentPath !== targetParentPath) {
      await this.hiraya.files.move(from.handle, parent, { signal });
      if (from.entry!.metadata.name !== name) {
        try { await this.hiraya.files.rename(from.handle, name, { signal }); }
        catch (error) {
          if (from.parent) await this.hiraya.files.move(from.handle, from.parent).catch(() => undefined);
          throw error;
        }
      }
    } else if (from.entry!.metadata.name !== name) await this.hiraya.files.rename(from.handle, name, { signal });
  }

  /** Removes an entry. */
  async remove(path: string, recursive: boolean, force: boolean, signal?: AbortSignal): Promise<void> {
    try {
      const resolved = await this.resolve(path, undefined, signal);
      await this.hiraya.files.delete(resolved.handle, recursive, { signal });
    } catch (error) {
      if (force && error instanceof HirayaSdkError && error.code === "NOT_FOUND") return;
      throw error;
    }
  }

  /** Opens the entry at a shell path. */
  async open(path: string, signal?: AbortSignal): Promise<void> {
    const resolved = await this.resolve(path, undefined, signal);
    await this.hiraya.host.openEntry(resolved.handle, { signal });
  }

  /** Imports an entry. */
  async import(path: string, folder: boolean, signal?: AbortSignal): Promise<void> {
    const resolved = await this.resolve(path, "folder", signal);
    if (folder) await this.hiraya.host.importFolder(resolved.handle as FolderHandle, { signal });
    else await this.hiraya.host.importFiles(resolved.handle as FolderHandle, { signal });
  }

  /** Resolves an entry handle to its absolute shell path. */
  async pathFor(handle: FileHandle | FolderHandle, signal?: AbortSignal): Promise<string> {
    const names: string[] = [];
    let current: FileHandle | FolderHandle | null = handle;
    while (current) {
      const entry = await this.hiraya.files.stat(current, { signal });
      names.unshift(entry.metadata.name);
      current = entry.metadata.parent;
    }
    return `/${names.join("/")}`;
  }

  /** Resolves a shell path to its filesystem entry. */
  private async resolve(path: string, kind?: "file" | "folder", signal?: AbortSignal): Promise<Resolved> {
    const normalized = clean(path);
    if (normalized === "/") return { path: "/", entry: null, handle: this.root, parent: null };
    let folder = this.root;
    let parent: FolderHandle | null = null;
    let entry: DirectoryEntry | undefined;
    const parts = normalized.slice(1).split("/");
    for (const [index, part] of parts.entries()) {
      parent = folder;
      entry = (await this.hiraya.files.list(folder, { signal })).find((candidate) => candidate.metadata.name === part);
      if (!entry) throw new HirayaSdkError(`No such file or folder: ${normalized}`, "NOT_FOUND");
      if (index < parts.length - 1) {
        if (entry.kind !== "folder") throw new HirayaSdkError(`Not a folder: ${part}`, "NOT_FOUND");
        folder = entry.metadata.handle;
      }
    }
    if (kind && entry?.kind !== kind) throw new Error(`${normalized}: not a ${kind}`);
    return { path: normalized, entry: entry!, handle: entry!.metadata.handle, parent };
  }

  /** Returns the parent path. */
  private async parent(path: string, signal?: AbortSignal) {
    const normalized = clean(path);
    const index = normalized.lastIndexOf("/");
    const name = normalized.slice(index + 1);
    if (!name) throw new Error("A root item name is required.");
    const parentPath = normalized.slice(0, index) || "/";
    const resolved = await this.resolve(parentPath, "folder", signal);
    return { parent: resolved.handle as FolderHandle, name };
  }

  /** Converts a filesystem entry to shell metadata. */
  private shellEntry(entry: DirectoryEntry, path: string): ShellEntry {
    return { path, name: entry.metadata.name, kind: entry.kind, size: entry.kind === "file" ? entry.metadata.size : 0, modifiedAt: entry.metadata.modifiedAt, ...(entry.kind === "file" ? { mimeType: entry.metadata.mimeType } : {}) };
  }
}

/** Normalizes a path. */
function clean(path: string) {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** Joins path segments. */
function join(parent: string, name: string) {
  return clean(`${parent}/${name}`);
}

/** Concatenates byte arrays. */
function concat(left: Uint8Array, right: Uint8Array) {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}
