import { describe, expect, test } from "bun:test";
import { desktopEntities, desktopEntityMovementPlan, desktopEntityParts, desktopSelectionCanDropIntoFolder, retainedDesktopEntityIds, spatialEntityId } from "../src/ui/desktop-entity";

describe("desktop entities", () => {
  test("namespaces persisted IDs and projects groups without changing their source data", () => {
    const folder = { id: "same", kind: "folder" as const, name: "Folder", parentId: null, createdAt: 0, modifiedAt: 0, position: { x: 10, y: 20 } };
    const widget = { id: "same", kind: "clock" as const, x: 300, y: 20, width: 200, height: 120 };
    const [group, projectedWidget] = desktopEntities([folder], [widget], [{ folderId: "same", width: 340, height: 260 }], { width: 90, height: 100 });
    expect(group.id).toBe("group:same");
    expect(projectedWidget.id).toBe("widget:same");
    expect(desktopEntityParts("entry:same")).toEqual({ kind: "entry", sourceId: "same" });
    expect(retainedDesktopEntityIds([group, projectedWidget], ["same", "group:same", "widget:same", "entry:missing"])).toEqual(new Set(["group:same", "widget:same"]));
  });

  test("navigates spatially across mixed entity kinds and orders Home/End visually", () => {
    const entities = [
      { id: "widget:w", x: 300, y: 0, width: 100, height: 100 },
      { id: "entry:e", x: 0, y: 0, width: 80, height: 80 },
      { id: "group:g", x: 0, y: 250, width: 200, height: 150 },
    ];
    expect(spatialEntityId(entities, "entry:e", "ArrowRight")).toBe("widget:w");
    expect(spatialEntityId(entities, "entry:e", "ArrowDown")).toBe("group:g");
    expect(spatialEntityId(entities, "widget:w", "Home")).toBe("entry:e");
    expect(spatialEntityId(entities, "entry:e", "End")).toBe("group:g");
  });

  test("moves a mixed selection by the anchor delta without changing source kinds", () => {
    const entities = [
      { id: "entry:e", kind: "entry" as const, x: 10, y: 20, width: 80, height: 80 },
      { id: "widget:w", kind: "widget" as const, x: 200, y: 40, width: 100, height: 100 },
      { id: "group:g", kind: "group" as const, x: 30, y: 220, width: 200, height: 150 },
    ];
    expect(desktopEntityMovementPlan(entities, new Set(entities.map((entity) => entity.id)), "widget:w", { x: 225, y: 30 })).toEqual({
      delta: { x: 25, y: -10 },
      moves: [
        { id: "entry:e", kind: "entry", position: { x: 35, y: 10 } },
        { id: "widget:w", kind: "widget", position: { x: 225, y: 30 } },
        { id: "group:g", kind: "group", position: { x: 55, y: 210 } },
      ],
    });
    expect(desktopSelectionCanDropIntoFolder(entities, new Set(["entry:e"]))).toBe(true);
    expect(desktopSelectionCanDropIntoFolder(entities, new Set(["entry:e", "widget:w"]))).toBe(false);
  });
});
