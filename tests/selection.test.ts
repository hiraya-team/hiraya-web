import { describe, expect, test } from "bun:test";
import { selectedEntryIds } from "../src/features/selection/controller";

describe("desktop selection", () => {
  test("selects, toggles, and preserves an existing selection", () => {
    expect(selectedEntryIds([], "b", null)).toEqual({ ids: ["b"], anchorId: "b" });
    expect(selectedEntryIds(["b"], "b", "b")).toBeNull();
    expect(selectedEntryIds(["a", "b"], "b", "a", { toggle: true })).toEqual({ ids: ["a"], anchorId: "b" });
    expect(selectedEntryIds(["a"], "b", "a", { toggle: true })).toEqual({ ids: ["a", "b"], anchorId: "b" });
  });

  test("selects an inclusive ordered range around its anchor", () => {
    expect(selectedEntryIds(["b"], "d", "b", { range: true, orderedIds: ["a", "b", "c", "d"] })).toEqual({ ids: ["b", "c", "d"], anchorId: "b" });
    expect(selectedEntryIds(["d"], "b", "d", { range: true, orderedIds: ["a", "b", "c", "d"] })).toEqual({ ids: ["b", "c", "d"], anchorId: "d" });
  });
});
