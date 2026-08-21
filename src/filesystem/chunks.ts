import {
  WEB2_CHUNK_SIZE,
  WEB2_OPFS_PREFIX,
  WEB2_SCHEMA_VERSION,
  assertExactKeys,
  canonicalManifestSha256,
  isRecord,
  parseManifest,
  parseMimeType,
  parsePositiveSafeInteger,
  parseSha256,
  sha256Hex,
  storageNamespaceHash,
  type ChunkRef,
  type Manifest,
} from "./model";

/** Defines the chunks directory. */
const CHUNKS_DIRECTORY = "chunks";
/** Defines the shard. */
const SHARD = /^[0-9a-f]{2}$/;

/** Reports chunk integrity failures. */
class ChunkIntegrityError extends Error {}

/** Parses and validates chunk ref. */
function parseChunkRef(value: unknown): ChunkRef {
  if (!isRecord(value)) throw new Error("A chunk reference has an unsupported shape.");
  assertExactKeys(value, ["hash", "size"], "A chunk reference has an unsupported shape.");
  const size = parsePositiveSafeInteger(value.size, "A chunk size is invalid.");
  if (size > WEB2_CHUNK_SIZE) throw new Error("A chunk size is invalid.");
  return { hash: parseSha256(value.hash, "A chunk hash is invalid."), size };
}

/** Reports whether an error represents a missing OPFS entry. */
function isNotFound(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === "NotFoundError";
}

/** Validates chunk content. */
async function verifyChunkContent(content: Blob, ref: ChunkRef, message: string) {
  const hash = await sha256Hex(await content.arrayBuffer());
  if (content.size !== ref.size || hash !== ref.hash) throw new ChunkIntegrityError(message);
}

/** Returns the OPFS file handle for a chunk. */
async function chunkFile(root: FileSystemDirectoryHandle, ref: ChunkRef, create: boolean) {
  const chunks = await root.getDirectoryHandle(CHUNKS_DIRECTORY, create ? { create: true } : undefined);
  const shard = await chunks.getDirectoryHandle(ref.hash.slice(0, 2), create ? { create: true } : undefined);
  return shard.getFileHandle(ref.hash, create ? { create: true } : undefined);
}

/** Returns the OPFS root for an account. */
export async function getAccountOpfsRoot(storageId: string, originRoot?: FileSystemDirectoryHandle) {
  const storageHash = await storageNamespaceHash(storageId);
  if (!originRoot) {
    if (typeof navigator === "undefined" || typeof navigator.storage?.getDirectory !== "function") throw new Error("Origin private file system storage is unavailable.");
    originRoot = await navigator.storage.getDirectory();
  }
  return originRoot.getDirectoryHandle(`${WEB2_OPFS_PREFIX}${storageHash}`, { create: true });
}

/** Reads chunk. */
export async function readChunk(root: FileSystemDirectoryHandle, value: ChunkRef) {
  const ref = parseChunkRef(value);
  const content = await (await chunkFile(root, ref, false)).getFile();
  await verifyChunkContent(content, ref, "Stored chunk content does not match its reference.");
  return content;
}

/** Writes chunk. */
export async function writeChunk(root: FileSystemDirectoryHandle, value: ChunkRef, content: Blob) {
  const ref = parseChunkRef(value);
  if (!(content instanceof Blob)) throw new TypeError("Chunk content must be a Blob.");
  await verifyChunkContent(content, ref, "Source chunk content does not match its reference.");

  try {
    await readChunk(root, ref);
    return;
  } catch (error) {
    if (!isNotFound(error) && !(error instanceof ChunkIntegrityError)) throw error;
  }

  const writable = await (await chunkFile(root, ref, true)).createWritable();
  await writable.write(content);
  await writable.close();
  await readChunk(root, ref);
}

/** Stages blob. */
export async function stageBlob(root: FileSystemDirectoryHandle, content: Blob) {
  const chunks: ChunkRef[] = [];
  for (let offset = 0; offset < content.size; offset += WEB2_CHUNK_SIZE) {
    const chunk = content.slice(offset, offset + WEB2_CHUNK_SIZE);
    const ref = { hash: await sha256Hex(await chunk.arrayBuffer()), size: chunk.size };
    await writeChunk(root, ref, chunk);
    chunks.push(ref);
  }
  const manifest = parseManifest({ schemaVersion: WEB2_SCHEMA_VERSION, size: content.size, chunkSize: WEB2_CHUNK_SIZE, chunks });
  return { manifest, manifestHash: await canonicalManifestSha256(manifest) };
}

/** Reconstructs a blob from its stored chunks. */
export async function reconstructBlob(root: FileSystemDirectoryHandle, value: unknown, mimeType?: string) {
  const manifest = parseManifest(value);
  const type = mimeType === undefined ? undefined : parseMimeType(mimeType);
  const chunks: Blob[] = [];
  for (const ref of manifest.chunks) chunks.push(await readChunk(root, ref));
  return new Blob(chunks, type === undefined ? undefined : { type });
}

/** Removes entry. */
async function removeEntry(directory: FileSystemDirectoryHandle, name: string) {
  try {
    await directory.removeEntry(name, { recursive: true });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

/** Removes orphan chunks. */
export async function removeOrphanChunks(root: FileSystemDirectoryHandle, retainedHashes: Iterable<string>) {
  const retained = new Set([...retainedHashes].map((hash) => parseSha256(hash, "A retained chunk hash is invalid.")));
  let chunks: FileSystemDirectoryHandle;
  try {
    chunks = await root.getDirectoryHandle(CHUNKS_DIRECTORY);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }

  const chunkEntries = chunks as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };
  try {
    for await (const [shardName, shardHandle] of chunkEntries.entries()) {
      if (!SHARD.test(shardName) || shardHandle.kind !== "directory") {
        await removeEntry(chunks, shardName);
        continue;
      }
      const shard = shardHandle as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };
      try {
        for await (const [hash, handle] of shard.entries()) {
          let canonical = false;
          try {
            canonical = parseSha256(hash) === hash && hash.startsWith(shardName);
          } catch { /* malformed entries are removed below */ }
          if (handle.kind !== "file" || !canonical || !retained.has(hash)) await removeEntry(shard, hash);
        }
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

export type { ChunkRef, Manifest };
