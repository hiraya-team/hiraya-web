import { describe, expect, test } from "bun:test";
import { openWithMenuItems } from "../src/ui/open-with-menu";

describe("Open with menu", () => {
  test("keeps open and default actions on one app row", () => {
    const items = openWithMenuItems([
      { id: "editor", label: "Text Editor", preferred: true, onOpen: () => undefined, onSetPreferred: () => undefined },
      { id: "viewer", label: "File Viewer", onOpen: () => undefined, onSetPreferred: () => undefined },
    ]);

    expect(items.map(({ label }) => label)).toEqual(["Text Editor", "File Viewer"]);
    expect(items[0]?.meta).toBe("Default");
    expect(items[0]?.secondaryAction).toBeUndefined();
    expect(items[1]?.secondaryAction?.label).toBe("Set default");
    expect(items[1]?.secondaryAction?.accessibleLabel).toBe("Always use File Viewer");
  });
});
