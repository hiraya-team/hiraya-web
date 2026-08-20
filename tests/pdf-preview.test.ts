import { describe, expect, test } from "bun:test";

describe("PDF previews", () => {
  test("preserve the blob origin inside sandboxed frames", async () => {
    const sources = await Promise.all([
      Bun.file(new URL("../src/components/FileWindow.tsx", import.meta.url)).text(),
      Bun.file(new URL("../src/components/MergeWindow.tsx", import.meta.url)).text(),
    ]);

    for (const source of sources) {
      expect(source).toContain('sandbox="allow-same-origin"');
      expect(source).not.toContain('sandbox=""');
    }
  });
});
