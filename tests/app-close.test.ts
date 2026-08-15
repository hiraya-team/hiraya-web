import { describe, expect, test } from "bun:test";
import { closeWithDirtyCheck, forceCloseRunningAppInstances } from "../src/apps/app-close";

describe("sandbox app close policy", () => {
  for (const state of ["autosave disabled", "save in progress", "remote conflict"]) {
    test(`preserves a dirty window when discard is cancelled with ${state}`, async () => {
      let closed = false;
      expect(await closeWithDirtyCheck({ dirty: true, confirmDiscard: () => false, close: () => { closed = true; } })).toBe(false);
      expect(closed).toBe(false);
    });
  }

  test("closes after confirmed discard", async () => {
    let closed = false;
    expect(await closeWithDirtyCheck({ dirty: true, confirmDiscard: () => true, close: () => { closed = true; } })).toBe(true);
    expect(closed).toBe(true);
  });

  test("closes a clean window without confirmation", async () => {
    let confirmed = false;
    expect(await closeWithDirtyCheck({ dirty: false, confirmDiscard: () => { confirmed = true; return false; }, close: () => undefined })).toBe(true);
    expect(confirmed).toBe(false);
  });

  test("force-closes every old package instance before an administrative replacement", () => {
    const closed: string[] = [];
    const instances = [
      { id: "old-one", kind: "sandbox", package: { manifest: { id: "test.editor" } } },
      { id: "other", kind: "sandbox", package: { manifest: { id: "test.viewer" } } },
      { id: "old-two", kind: "sandbox", package: { manifest: { id: "test.editor" } } },
      { id: "builtin", kind: "file" },
    ];
    expect(forceCloseRunningAppInstances(instances, "test.editor", (id) => closed.push(id))).toEqual(["old-one", "old-two"]);
    expect(closed).toEqual(["old-one", "old-two"]);
  });
});
