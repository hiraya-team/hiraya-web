import { describe, expect, test } from "bun:test";
import { isValidMimeType, readRevision } from "../src/lib/contracts";
import { parseCustomTheme } from "../src/lib/themes";

type Corpus = {
  themes: Array<{ name: string; valid: boolean; theme: unknown }>;
  mimeTypes: Array<{ value: string; valid: boolean }>;
  revisions: Array<{ value: number; valid: boolean }>;
};

const corpus = await Bun.file(new URL("../../testdata/wire-contract-boundaries.json", import.meta.url)).json() as Corpus;

describe("shared Go and TypeScript wire boundaries", () => {
  for (const item of corpus.themes) test(`theme: ${item.name}`, () => {
    if (item.valid) expect(() => parseCustomTheme(item.theme)).not.toThrow();
    else expect(() => parseCustomTheme(item.theme)).toThrow();
  });

  test("MIME boundaries", () => {
    for (const item of corpus.mimeTypes) expect(isValidMimeType(item.value), item.value).toBe(item.valid);
  });

  test("revision boundaries", () => {
    for (const item of corpus.revisions) {
      const valid = (() => { try { readRevision(item.value); return true; } catch { return false; } })();
      expect(valid, String(item.value)).toBe(item.valid);
    }
  });
});
