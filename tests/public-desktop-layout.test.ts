import { describe, expect, test } from "bun:test";
import { publicFolderBackTarget } from "../src/ui/public-desktop-layout";

describe("public desktop navigation", () => {
  test("resolves public back navigation without inventing controls", () => {
    const entries = [
      { kind: "folder" as const, id: "parent", name: "Parent", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
      { kind: "folder" as const, id: "child", name: "Child", parentId: "parent", createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
    ];
    expect(publicFolderBackTarget(entries, "child")).toBe("parent");
    expect(publicFolderBackTarget(entries, "parent")).toBeNull();
    expect(publicFolderBackTarget(entries, "missing")).toBeUndefined();
  });
});
