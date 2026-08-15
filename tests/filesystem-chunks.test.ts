import { describe, expect, test } from "bun:test";
import { getAccountOpfsRoot, readChunk, reconstructBlob, removeOrphanChunks, stageBlob, writeChunk } from "../src/filesystem/chunks";
import { WEB2_CHUNK_SIZE, WEB2_OPFS_PREFIX, type ChunkRef, type Manifest } from "../src/filesystem/model";
import { MemoryDirectory, memoryChunk, memoryOpfsHandle } from "./support/memory-opfs";

const ACCOUNT_A = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_B = "00000000-0000-4000-8000-000000000002";
const ACCOUNT_A_HASH = "11e594f481958c10e3015d0bf0447a22f068a8a647f475df15ce2c7ab4b8f3f1";
const ACCOUNT_B_HASH = "e79acd97ac88086665d85a762f43d533a45195b6bac5961a993e6ed362471439";
const FULL_HASH = "9bc1b2a288b26af7257a36277ae3816a7d4f16e89c1e7e77d0a5c48bad62b360";
const TAIL_HASH = "ae4b3280e56e2faf83f414a6e3dabe9d5fbe18976544c05fed121accb85b53fc";
const MULTI_MANIFEST_HASH = "2c2304e63694f4365904a54a2fa9f883c45dd0e3c3080f8f53ba0329e28f0dd6";
const STABLE_HASH = "f379ccb92b9116442dc65bdc35648a85d3786b34779db7f704a901fa07b00cb6";

function chunkPath(root: MemoryDirectory, ref: ChunkRef) {
  return memoryChunk(root, ref.hash);
}

describe("web2 filesystem chunks", () => {
  test("isolates canonical account UUIDs in only the fresh full-hash namespace", async () => {
    const origin = new MemoryDirectory();
    const first = await getAccountOpfsRoot(ACCOUNT_A, memoryOpfsHandle(origin));
    const second = await getAccountOpfsRoot(ACCOUNT_B, memoryOpfsHandle(origin));

    expect(first).not.toBe(second);
    expect([...origin.directories.keys()]).toEqual([
      `${WEB2_OPFS_PREFIX}${ACCOUNT_A_HASH}`,
      `${WEB2_OPFS_PREFIX}${ACCOUNT_B_HASH}`,
    ]);
    expect([...origin.directories.keys()].some((name) => name.startsWith(".hiraya-storage-"))).toBe(false);
    expect(origin.directoryRequests).toEqual([
      `${WEB2_OPFS_PREFIX}${ACCOUNT_A_HASH}`,
      `${WEB2_OPFS_PREFIX}${ACCOUNT_B_HASH}`,
    ]);
    await expect(getAccountOpfsRoot("00000000-0000-4000-8000-00000000000A", memoryOpfsHandle(origin))).rejects.toThrow("account ID");
    expect(origin.directories.size).toBe(2);
  });

  test("stages exact fixed-size chunks and the canonical known manifest", async () => {
    const root = new MemoryDirectory();
    const bytes = new Uint8Array(WEB2_CHUNK_SIZE + 3);
    bytes.fill(97, 0, WEB2_CHUNK_SIZE);
    bytes.set([0, 1, 2], WEB2_CHUNK_SIZE);

    const staged = await stageBlob(memoryOpfsHandle(root), new Blob([bytes]));
    const expected: Manifest = {
      schemaVersion: 1,
      size: WEB2_CHUNK_SIZE + 3,
      chunkSize: WEB2_CHUNK_SIZE,
      chunks: [
        { hash: FULL_HASH, size: WEB2_CHUNK_SIZE },
        { hash: TAIL_HASH, size: 3 },
      ],
    };
    expect(staged).toEqual({ manifest: expected, manifestHash: MULTI_MANIFEST_HASH });
    expect(chunkPath(root, expected.chunks[0]!)).toBeDefined();
    expect(chunkPath(root, expected.chunks[1]!)).toBeDefined();
  });

  test("stages and reconstructs empty content without creating chunk storage", async () => {
    const root = new MemoryDirectory();
    const { manifest, manifestHash } = await stageBlob(memoryOpfsHandle(root), new Blob());
    expect(manifest).toEqual({ schemaVersion: 1, size: 0, chunkSize: WEB2_CHUNK_SIZE, chunks: [] });
    expect(manifestHash).toBe("d76845a0f6bb357481c9d592f86775f971fa32f78ac09c5e312e2f956e3f538a");
    expect(root.directories.has("chunks")).toBe(false);
    expect(await reconstructBlob(memoryOpfsHandle(root), manifest, "application/octet-stream")).toMatchObject({ size: 0, type: "application/octet-stream" });
  });

  test("does not rewrite a valid existing chunk", async () => {
    const root = new MemoryDirectory();
    const content = new Blob(["stable"]);
    const ref = { hash: STABLE_HASH, size: 6 };
    await writeChunk(memoryOpfsHandle(root), ref, content);
    const stored = chunkPath(root, ref)!;
    await writeChunk(memoryOpfsHandle(root), ref, content);
    expect(stored.writes).toBe(1);
  });

  test("rejects mismatched source bytes before touching OPFS", async () => {
    const root = new MemoryDirectory();
    const ref = { hash: "88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589", size: 4 };
    for (const invalid of [
      { hash: FULL_HASH.toUpperCase(), size: 1 },
      { hash: FULL_HASH, size: 0 },
      { hash: FULL_HASH, size: WEB2_CHUNK_SIZE + 1 },
    ]) await expect(readChunk(memoryOpfsHandle(root), invalid)).rejects.toThrow();
    await expect(writeChunk(memoryOpfsHandle(root), ref, new Blob(["abce"]))).rejects.toThrow("Source chunk");
    expect(root.directoryReads).toBe(0);
    expect(root.directories.size).toBe(0);
  });

  test("repairs corrupt stored bytes and verifies the reopened final object", async () => {
    const root = new MemoryDirectory();
    const content = new Blob(["stable"]);
    const ref = { hash: STABLE_HASH, size: 6 };
    await writeChunk(memoryOpfsHandle(root), ref, content);
    const stored = chunkPath(root, ref)!;
    stored.content = new Blob(["staple"]);

    await writeChunk(memoryOpfsHandle(root), ref, content);
    expect(stored.writes).toBe(2);
    expect(await (await readChunk(memoryOpfsHandle(root), ref)).text()).toBe("stable");
  });

  test("detects corruption applied when the final write closes", async () => {
    const root = new MemoryDirectory();
    const ref = { hash: STABLE_HASH, size: 6 };
    const shard = root.directory("chunks").directory(ref.hash.slice(0, 2));
    shard.file(ref.hash, new Blob(["broken"])).corruptNextClose = true;
    await expect(writeChunk(memoryOpfsHandle(root), ref, new Blob(["stable"]))).rejects.toThrow("Stored chunk");
  });

  test("detects read and ordered reconstruction corruption before returning bytes", async () => {
    const root = new MemoryDirectory();
    const first = new Blob([new Uint8Array(WEB2_CHUNK_SIZE).fill(97)]);
    const firstRef = { hash: FULL_HASH, size: WEB2_CHUNK_SIZE };
    const lastRef = { hash: TAIL_HASH, size: 3 };
    await writeChunk(memoryOpfsHandle(root), firstRef, first);
    await writeChunk(memoryOpfsHandle(root), lastRef, new Blob([new Uint8Array([0, 1, 2])]));
    chunkPath(root, lastRef)!.content = new Blob([new Uint8Array([0, 1, 3])]);

    await expect(readChunk(memoryOpfsHandle(root), lastRef)).rejects.toThrow("Stored chunk");
    await expect(reconstructBlob(memoryOpfsHandle(root), {
      schemaVersion: 1,
      size: WEB2_CHUNK_SIZE + 3,
      chunkSize: WEB2_CHUNK_SIZE,
      chunks: [firstRef, lastRef],
    })).rejects.toThrow("Stored chunk");
  });

  test("preserves repeated hashes while reconstructing a typed Blob", async () => {
    const root = new MemoryDirectory();
    const content = new Blob([new Uint8Array(WEB2_CHUNK_SIZE).fill(97)]);
    const ref = { hash: FULL_HASH, size: WEB2_CHUNK_SIZE };
    await writeChunk(memoryOpfsHandle(root), ref, content);
    const stored = chunkPath(root, ref)!;
    const readsBefore = stored.reads;
    const blob = await reconstructBlob(memoryOpfsHandle(root), {
      schemaVersion: 1,
      size: WEB2_CHUNK_SIZE * 2,
      chunkSize: WEB2_CHUNK_SIZE,
      chunks: [ref, ref],
    }, "application/octet-stream");

    expect(blob).toMatchObject({ size: WEB2_CHUNK_SIZE * 2, type: "application/octet-stream" });
    expect(stored.reads - readsBefore).toBe(2);
    expect(new Uint8Array(await blob.arrayBuffer())[WEB2_CHUNK_SIZE]).toBe(97);
  });

  test("removes orphaned and malformed objects while retaining canonical paths and empty shards", async () => {
    const root = new MemoryDirectory();
    const chunks = root.directory("chunks");
    const retained = "aa" + "1".repeat(62);
    const orphan = "aa" + "2".repeat(62);
    const shard = chunks.directory("aa");
    shard.file(retained, new Blob(["keep"]));
    shard.file(orphan, new Blob(["drop"]));
    shard.file("MALFORMED", new Blob(["drop"]));
    shard.directory("bb" + "3".repeat(62)).file("nested", new Blob(["drop"]));
    chunks.directory("bb").file(retained, new Blob(["misplaced"]));
    chunks.directory("not-a-shard").file(retained, new Blob(["drop"]));
    chunks.file("cc", new Blob(["drop"]));

    await removeOrphanChunks(memoryOpfsHandle(root), new Set([retained]));
    expect([...chunks.directories.keys()]).toEqual(["aa", "bb"]);
    expect([...shard.files.keys()]).toEqual([retained]);
    expect(shard.directories.size).toBe(0);
    expect(chunks.directories.get("bb")!.files.size).toBe(0);
    expect(chunks.files.size).toBe(0);
  });

  test("validates all retained hashes before cleanup and does not create a missing chunks directory", async () => {
    const root = new MemoryDirectory();
    await expect(removeOrphanChunks(memoryOpfsHandle(root), new Set([FULL_HASH, "INVALID"]))).rejects.toThrow("retained chunk hash");
    expect(root.directoryReads).toBe(0);
    await removeOrphanChunks(memoryOpfsHandle(root), new Set());
    expect(root.directoryReads).toBe(1);
    expect(root.directories.size).toBe(0);
  });
});
