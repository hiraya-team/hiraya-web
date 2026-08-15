export class MemoryFile {
  content: Blob;
  reads = 0;
  writes = 0;
  corruptNextClose = false;
  beforeClose?: () => Promise<void>;

  constructor(content = new Blob()) {
    this.content = content;
  }
}

class MemoryFileHandle {
  readonly kind = "file";

  constructor(readonly name: string, readonly entry: MemoryFile) {}

  async getFile() {
    this.entry.reads += 1;
    return this.entry.content as File;
  }

  async createWritable() {
    let pending = this.entry.content;
    return {
      write: async (content: FileSystemWriteChunkType) => {
        if (!(content instanceof Blob)) throw new TypeError("The test OPFS fake accepts Blob writes only.");
        pending = content;
      },
      close: async () => {
        await this.entry.beforeClose?.();
        this.entry.writes += 1;
        if (this.entry.corruptNextClose) {
          this.entry.corruptNextClose = false;
          pending = new Blob([new Uint8Array(pending.size).fill(255)]);
        }
        this.entry.content = pending;
      },
    } as unknown as FileSystemWritableFileStream;
  }
}

export class MemoryDirectory {
  readonly kind = "directory";
  readonly directories = new Map<string, MemoryDirectory>();
  readonly files = new Map<string, MemoryFile>();
  readonly directoryRequests: string[] = [];
  directoryReads = 0;
  beforeFileClose?: (name: string) => Promise<void>;

  constructor(readonly name = "") {}

  directory(name: string) {
    const directory = new MemoryDirectory(name);
    this.directories.set(name, directory);
    return directory;
  }

  file(name: string, content = new Blob()) {
    const file = new MemoryFile(content);
    if (this.beforeFileClose) file.beforeClose = () => this.beforeFileClose!(name);
    this.files.set(name, file);
    return file;
  }

  async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions) {
    this.directoryReads += 1;
    this.directoryRequests.push(name);
    const existing = this.directories.get(name);
    if (existing) return existing as unknown as FileSystemDirectoryHandle;
    if (!options?.create) throw new DOMException("Not found", "NotFoundError");
    return this.directory(name) as unknown as FileSystemDirectoryHandle;
  }

  async getFileHandle(name: string, options?: FileSystemGetFileOptions) {
    let entry = this.files.get(name);
    if (!entry && !options?.create) throw new DOMException("Not found", "NotFoundError");
    entry ??= this.file(name);
    return new MemoryFileHandle(name, entry) as unknown as FileSystemFileHandle;
  }

  async removeEntry(name: string, options?: FileSystemRemoveOptions) {
    if (this.files.delete(name)) return;
    const directory = this.directories.get(name);
    if (!directory || !options?.recursive && (directory.files.size > 0 || directory.directories.size > 0)) throw new DOMException("Not found", "NotFoundError");
    this.directories.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    for (const [name, directory] of [...this.directories]) yield [name, directory as unknown as FileSystemDirectoryHandle];
    for (const [name, entry] of [...this.files]) yield [name, new MemoryFileHandle(name, entry) as unknown as FileSystemFileHandle];
  }
}

export function memoryOpfsHandle(directory: MemoryDirectory) {
  return directory as unknown as FileSystemDirectoryHandle;
}

export function memoryChunk(root: MemoryDirectory, hash: string) {
  return root.directories.get("chunks")?.directories.get(hash.slice(0, 2))?.files.get(hash);
}
