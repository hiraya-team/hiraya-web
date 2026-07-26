import { describe, expect, test } from "bun:test";
import { runningAppIds, runningAppIsInSegment, runningAppSegment, runningAppTargets, topRunningAppInSegment, type RunningApp } from "../src/features/windows/model";
import { createRouteHistoryState, parseRunningAppHistory, routeForRunningApp } from "../src/features/windows/history";

const size = { width: 1000, height: 700 };
const apps: RunningApp[] = [
  { id: "settings", kind: "settings", bounds: { x: 20, y: 20, width: 500, height: 400 }, minimized: false, zIndex: 2 },
  { id: "folder", kind: "explorer", folderId: "folder-id", bounds: { x: 1020, y: 20, width: 500, height: 400 }, minimized: false, zIndex: 4 },
  { id: "file", kind: "file", fileId: "file-id", bounds: { x: 40, y: 40, width: 500, height: 400 }, minimized: true, zIndex: 5, editMode: false, contentRevision: 1, remoteChanged: false },
];

describe("running window projections", () => {
  test("projects windows onto signed desktop segments", () => {
    expect(runningAppSegment(apps[0], size)).toEqual({ column: 0, row: 0 });
    expect(runningAppSegment(apps[1], size)).toEqual({ column: 1, row: 0 });
    expect(runningAppIsInSegment(apps[1], { column: 1, row: 0 }, size)).toBe(true);
  });

  test("selects the top visible non-excluded window in an area", () => {
    expect(topRunningAppInSegment(apps, { column: 0, row: 0 }, size)?.id).toBe("settings");
    expect(topRunningAppInSegment(apps, { column: 0, row: 0 }, size, "settings")).toBeNull();
  });

  test("derives stable persistence targets and instance IDs", () => {
    expect(runningAppIds(apps)).toEqual(["settings", "folder", "file"]);
    expect(runningAppTargets(apps)).toEqual([
      { kind: "settings" },
      { kind: "explorer", folderId: "folder-id" },
      { kind: "file", fileId: "file-id" },
    ]);
  });

  test("builds strict route history and routes focused windows", () => {
    const targets = runningAppTargets(apps);
    const state = createRouteHistoryState(targets, runningAppIds(apps), "main", "#/previous");
    expect(parseRunningAppHistory(state)).toEqual(targets);
    expect(parseRunningAppHistory({ ...state, schemaVersion: 2 })).toBeNull();
    expect(routeForRunningApp(apps[1], { desktopId: "desktop", column: 1, row: 0 }, "desktop")).toEqual({ desktopId: "desktop", column: 1, row: 0, explorerFolderId: "folder-id" });
  });
});
