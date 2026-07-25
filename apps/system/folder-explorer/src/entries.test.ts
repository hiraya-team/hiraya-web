import { expect, test } from "bun:test";
import { entryTapAction, selectionAfterInteraction, sortEntries } from "./entries";

test("sorts folders first and names naturally", () => {
  const metadata = { modifiedAt: 0, parent: null };
  const entries = [
    { kind: "file", metadata: { ...metadata, handle: "file_abcdefghijklmnop", name: "File 10", mimeType: "text/plain", size: 0, contentRevision: 1 } },
    { kind: "folder", metadata: { ...metadata, handle: "folder_abcdefghijklmnop", name: "Work" } },
    { kind: "file", metadata: { ...metadata, handle: "file_ponmlkjihgfedcba", name: "File 2", mimeType: "text/plain", size: 0, contentRevision: 1 } },
  ];
  expect(sortEntries(entries as never).map((entry) => entry.metadata.name)).toEqual(["Work", "File 2", "File 10"]);
});

test("supports keyboard-style toggle and range multi-selection", () => {
  const order = ["a", "b", "c", "d"];
  expect(selectionAfterInteraction(["b"], "d", order, { toggle: true })).toEqual(["b", "d"]);
  expect(selectionAfterInteraction(["b", "d"], "b", order, { toggle: true })).toEqual(["d"]);
  expect(selectionAfterInteraction(["b"], "d", order, { range: true, anchor: "b" })).toEqual(["b", "c", "d"]);
  expect(selectionAfterInteraction(["b"], "d", order, { additive: true })).toEqual(["b", "d"]);
  expect(selectionAfterInteraction(["b"], "b", order, { additive: true })).toEqual(["b"]);
});

test("opens only after a second touch on the same nearby entry", () => {
  const first = { handle: "a", x: 10, y: 10, at: 1_000 };
  expect(entryTapAction(null, first, true)).toBe("select");
  expect(entryTapAction(first, { ...first, x: 18, at: 1_300 }, true)).toBe("open");
  expect(entryTapAction(first, { ...first, handle: "b", at: 1_300 }, true)).toBe("select");
  expect(entryTapAction(first, { ...first, at: 1_300 }, false)).toBe("none");
});
