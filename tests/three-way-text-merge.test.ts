import { describe, expect, test } from "bun:test";
import {
  THREE_WAY_TEXT_MERGE_MAX_BYTES,
  THREE_WAY_TEXT_MERGE_MAX_LINES,
  mergeThreeWayText,
} from "../src/lib/three-way-text-merge";

const bytes = (text: string) => new TextEncoder().encode(text);
const merge = (base: string, mine: string, server: string) => mergeThreeWayText(bytes(base), bytes(mine), bytes(server));

describe("three-way text merge", () => {
  test("automatically applies local-only and server-only edits", () => {
    expect(merge("one\ntwo\n", "one\nlocal\n", "one\ntwo\n")).toMatchObject({ status: "merged", text: "one\nlocal\n" });
    expect(merge("one\ntwo\n", "one\ntwo\n", "one\nserver\n")).toMatchObject({ status: "merged", text: "one\nserver\n" });
  });

  test("automatically combines disjoint edits", () => {
    expect(merge("one\nkeep\nthree\n", "ONE\nkeep\nthree\n", "one\nkeep\nTHREE\n")).toEqual({
      status: "merged",
      text: "ONE\nkeep\nTHREE\n",
      regions: [{ kind: "resolved", text: "ONE\nkeep\nTHREE\n" }],
    });
  });

  test("automatically accepts identical overlapping edits", () => {
    expect(merge("one\ntwo\nthree\n", "one\nsame\nthree\n", "one\nsame\nthree\n")).toMatchObject({
      status: "merged",
      text: "one\nsame\nthree\n",
    });
  });

  test("returns structured overlapping conflicts without markers", () => {
    const result = merge("one\nbase\nthree\n", "one\nmine\nthree\n", "one\nserver\nthree\n");
    expect(result).toEqual({
      status: "conflict",
      regions: [
        { kind: "resolved", text: "one\n" },
        { kind: "unresolved", base: "base\n", mine: "mine\n", server: "server\n" },
        { kind: "resolved", text: "three\n" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("<<<<<<<");
  });

  test("merges insertions and deletions", () => {
    expect(merge("one\ntwo\n", "one\ninserted\ntwo\n", "one\ntwo\n")).toMatchObject({ status: "merged", text: "one\ninserted\ntwo\n" });
    expect(merge("one\ntwo\n", "one\ntwo\n", "one\n")).toMatchObject({ status: "merged", text: "one\n" });
  });

  test("handles empty files", () => {
    expect(merge("", "", "")).toEqual({ status: "merged", text: "", regions: [] });
    expect(merge("", "added\n", "")).toMatchObject({ status: "merged", text: "added\n" });
  });

  test("preserves LF and CRLF line endings", () => {
    expect(merge("a\nb\n", "a\nB\n", "a\nb\n")).toMatchObject({ status: "merged", text: "a\nB\n" });
    expect(merge("a\r\nb\r\n", "a\r\nB\r\n", "a\r\nb\r\n")).toMatchObject({ status: "merged", text: "a\r\nB\r\n" });
  });

  test("preserves the presence or absence of a final newline", () => {
    expect(merge("a\nb", "a\nB", "a\nb")).toMatchObject({ status: "merged", text: "a\nB" });
    expect(merge("a\nb\n", "a\nB\n", "a\nb\n")).toMatchObject({ status: "merged", text: "a\nB\n" });
  });

  test("rejects invalid UTF-8 with the affected source", () => {
    expect(mergeThreeWayText(bytes("base"), new Uint8Array([0xc3, 0x28]), bytes("server"))).toEqual({
      status: "unavailable",
      reason: { kind: "invalid-utf8", source: "mine" },
    });
  });

  test("rejects inputs over the byte and line limits", () => {
    expect(mergeThreeWayText(bytes("base"), new Uint8Array(THREE_WAY_TEXT_MERGE_MAX_BYTES + 1), bytes("server"))).toEqual({
      status: "unavailable",
      reason: { kind: "too-large", source: "mine", limitBytes: THREE_WAY_TEXT_MERGE_MAX_BYTES },
    });
    expect(merge("", "", "x\n".repeat(THREE_WAY_TEXT_MERGE_MAX_LINES + 1))).toEqual({
      status: "unavailable",
      reason: { kind: "too-many-lines", source: "server", limitLines: THREE_WAY_TEXT_MERGE_MAX_LINES },
    });
  });
});
