import { describe, expect, test } from "bun:test";
import { actionSheetHistoryState, actionSheetHistoryToken } from "../src/ui/action-sheet-history";

describe("action sheet history", () => {
  test("adds a token without changing existing route history", () => {
    const route = { hiraya: true, schemaVersion: 1, apps: [{ kind: "settings" }] };
    expect(actionSheetHistoryState(route, "sheet-1")).toEqual({ ...route, hirayaActionSheet: "sheet-1" });
    expect(actionSheetHistoryToken(actionSheetHistoryState(route, "sheet-1"))).toBe("sheet-1");
  });

  test("ignores absent and malformed tokens", () => {
    expect(actionSheetHistoryToken(null)).toBeNull();
    expect(actionSheetHistoryToken({ hirayaActionSheet: 1 })).toBeNull();
  });
});
