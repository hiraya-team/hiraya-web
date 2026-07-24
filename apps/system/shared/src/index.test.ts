import { describe, expect, test } from "bun:test";
import { formatBytes, readFileData } from "./index";

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
});
