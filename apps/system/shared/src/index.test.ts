import { describe, expect, test } from "bun:test";
import { DownloadUrlLease, formatBytes, LatestOperation, readFileData } from "./index";

describe("system app helpers", () => {
  test("formats file sizes", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(12 * 1024 * 1024)).toBe("12 MB");
  });

  test("uses a detected chunk reader and joins chunks", async () => {
    const source = new TextEncoder().encode("chunked");
    const files = {
      read: () => { throw new Error("whole read should not run"); },
      readChunk: (_handle: string, offset: number, length: number) => Promise.resolve({
        data: source.slice(offset, offset + length).buffer,
        done: offset + length >= source.length,
      }),
    };
    const data = await readFileData({ files } as never, "file_abcdefghijklmnop" as never, source.length);
    expect(new TextDecoder().decode(data)).toBe("chunked");
  });

  test("invalidates stale authored operations", () => {
    const operations = new LatestOperation();
    const first = operations.begin();
    const second = operations.begin();
    expect(operations.isLatest(first)).toBe(false);
    expect(operations.isLatest(second)).toBe(true);
    operations.invalidate();
    expect(operations.isLatest(second)).toBe(false);
  });

  test("retains only the latest download URL and revokes it on disposal", () => {
    const revoked: string[] = [];
    const clicked: string[] = [];
    let id = 0;
    const lease = new DownloadUrlLease(
      { createObjectURL: () => `blob:${++id}`, revokeObjectURL: (url) => revoked.push(url) },
      () => ({ href: "", download: "", click() { clicked.push(this.href); }, remove() {} }) as HTMLAnchorElement,
    );
    lease.download(new ArrayBuffer(1), "application/octet-stream", "one.bin");
    expect(revoked).toEqual([]);
    lease.download(new ArrayBuffer(1), "application/octet-stream", "two.bin");
    expect(clicked).toEqual(["blob:1", "blob:2"]);
    expect(revoked).toEqual(["blob:1"]);
    lease.dispose();
    lease.dispose();
    expect(revoked).toEqual(["blob:1", "blob:2"]);
    expect(() => lease.download(new ArrayBuffer(0), "application/octet-stream", "late.bin")).toThrow("closed");
  });
});
