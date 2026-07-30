import { connectHiraya, HirayaSdkError, type FileHandle, type FileMetadata, type FolderHandle, type HirayaClient, type LaunchContext } from "@hiraya/apps-sdk";

export interface ConnectedApp {
  hiraya: HirayaClient;
  launch: LaunchContext;
  onDispose(cleanup: () => void): () => void;
  dispose(): void;
}

export async function connectSystemApp(appId: string): Promise<ConnectedApp> {
  document.body.classList.add("hiraya-app");
  const hiraya = await connectHiraya({ appId });
  try {
    const launch = await hiraya.app.getLaunchContext();
    const cleanups = new Set<() => void>();
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups) cleanup();
      cleanups.clear();
      hiraya.close();
    };
    addEventListener("pagehide", dispose, { once: true });
    return { hiraya, launch, onDispose: (cleanup) => { cleanups.add(cleanup); return () => cleanups.delete(cleanup); }, dispose };
  } catch (error) {
    hiraya.close();
    throw error;
  }
}

type ChunkFiles = {
  readChunk?: (handle: FileHandle, offset: number, length: number) => Promise<{ data: ArrayBuffer; done?: boolean }>;
  readAll?: (handle: FileHandle) => Promise<{ data: ArrayBuffer; mimeType: string }>;
};

export async function readFileData(hiraya: HirayaClient, handle: FileHandle, size?: number): Promise<ArrayBuffer> {
  const files = hiraya.files as ChunkFiles;
  if (typeof files.readAll === "function") return (await files.readAll(handle)).data;
  const readChunk = files.readChunk;
  if (typeof readChunk !== "function") return (await hiraya.files.read(handle)).data;
  const chunkSize = 1024 * 1024;
  const chunks: Uint8Array[] = [];
  let offset = 0;
  while (size === undefined || offset < size) {
    const requested = size === undefined ? chunkSize : Math.min(chunkSize, size - offset);
    const result = await readChunk.call(hiraya.files, handle, offset, requested);
    const chunk = new Uint8Array(result.data);
    chunks.push(chunk);
    offset += chunk.byteLength;
    if (result.done || chunk.byteLength < requested || chunk.byteLength === 0) break;
  }
  const data = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let cursor = 0;
  for (const chunk of chunks) {
    data.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return data.buffer;
}

export function relativeReader(hiraya: HirayaClient): ((from: FileHandle | FolderHandle, path: string) => Promise<{ data: ArrayBuffer; mimeType: string }>) | null {
  const files = hiraya.files as unknown as {
    readRelative?: (from: FileHandle | FolderHandle, path: string) => Promise<{ data: ArrayBuffer; mimeType: string }>;
    resolve?: (from: FileHandle | FolderHandle, path: string) => Promise<{ kind: "file"; metadata: FileMetadata } | { kind: "folder" }>;
  };
  if (typeof files.readRelative === "function") return files.readRelative.bind(files);
  if (typeof files.resolve !== "function") return null;
  return async (from, path) => {
    const entry = await files.resolve!(from, path);
    if (entry.kind !== "file") throw new TypeError("The relative path does not reference a file.");
    return { data: await readFileData(hiraya, entry.metadata.handle, entry.metadata.size), mimeType: entry.metadata.mimeType };
  };
}

export async function writeFileData(hiraya: HirayaClient, handle: FileHandle, data: ArrayBuffer, options: { mimeType: string; expectedRevision?: number }): Promise<FileMetadata> {
  const files = hiraya.files as unknown as {
    writeAll?: (handle: FileHandle, data: ArrayBuffer, options: { mimeType: string; expectedRevision?: number }) => Promise<FileMetadata>;
  };
  if (typeof files.writeAll === "function") return files.writeAll(handle, data, options);
  return hiraya.files.write(handle, data, options);
}

export function describeError(error: unknown, fallback: string): string {
  if (error instanceof HirayaSdkError) return error.code === "CANCELLED" ? "" : `${fallback} ${error.message} (${error.code})`;
  return error instanceof Error ? `${fallback} ${error.message}` : fallback;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

export class LatestOperation {
  #generation = 0;

  begin(): number { return ++this.#generation; }
  isLatest(generation: number): boolean { return generation === this.#generation; }
  invalidate(): void { this.#generation += 1; }
}

export class DownloadUrlLease {
  #url: string | null = null;
  #disposed = false;

  constructor(
    private readonly urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL,
    private readonly createAnchor: () => HTMLAnchorElement = () => document.createElement("a"),
  ) {}

  download(data: ArrayBuffer, mimeType: string, name: string): void {
    if (this.#disposed) throw new Error("Download URL lease is closed.");
    if (this.#url) this.urls.revokeObjectURL(this.#url);
    const url = this.urls.createObjectURL(new Blob([data], { type: mimeType }));
    this.#url = url;
    const anchor = this.createAnchor();
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    anchor.remove();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#url) this.urls.revokeObjectURL(this.#url);
    this.#url = null;
  }
}

export function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}
