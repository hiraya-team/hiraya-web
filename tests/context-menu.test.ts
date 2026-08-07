import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextMenu, DesktopContextMenu } from "../src/components/ContextMenu";
import { PasteFromDeviceDialog } from "../src/components/PasteFromDeviceDialog";
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

describe("Context menu presentation", () => {
  const entry = { kind: "file" as const, id: "file", name: "notes.txt", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "text/plain", size: 4 };
  const callbacks = { onOpen() {}, onRename() {}, onCopy() {}, onMove() {}, onProperties() {}, onDelete() {}, onClose() {} };

  test("uses a positioned menu for pointing and keyboard invocation", () => {
    const markup = renderToStaticMarkup(createElement(ContextMenu, { ...callbacks, entry, menu: { type: "entry", entryId: entry.id, x: 24, y: 80, presentation: "menu" } }));

    expect(markup).toContain("data-positioned");
    expect(markup).not.toContain("action-sheet-backdrop");
  });

  test("uses the modal action sheet only for touch invocation", () => {
    const markup = renderToStaticMarkup(createElement(ContextMenu, { ...callbacks, entry, menu: { type: "entry", entryId: entry.id, x: 24, y: 80, presentation: "sheet" } }));

    expect(markup).toContain("action-sheet-backdrop");
    expect(markup).not.toContain("data-positioned");
  });
});

describe("Paste actions", () => {
  test("keeps Paste available without a pre-inspected clipboard", () => {
    const desktop = renderToStaticMarkup(createElement(DesktopContextMenu, {
      menu: { type: "desktop", parentId: null, position: { x: 20, y: 30 }, x: 20, y: 30, presentation: "menu" },
      onCreateFile() {}, onCreateFolder() {}, onUpload() {}, onImportFolder() {}, onPaste() {}, onClose() {},
    }));
    const folder = { kind: "folder" as const, id: "folder", name: "Folder", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } };
    const entry = renderToStaticMarkup(createElement(ContextMenu, {
      menu: { type: "entry", entryId: folder.id, x: 20, y: 30, presentation: "menu" }, entry: folder,
      onOpen() {}, onRename() {}, onCopy() {}, onPasteInto() {}, onMove() {}, onProperties() {}, onDelete() {}, onClose() {},
    }));

    expect(desktop).toContain("Paste");
    expect(desktop).toContain("Ctrl/⌘ V");
    expect(entry).toContain("Paste into");
  });

  test("explains the native paste fallback", () => {
    const markup = renderToStaticMarkup(createElement(PasteFromDeviceDialog, { onClose() {} }));

    expect(markup).toContain("Paste from device");
    expect(markup).toContain("Ctrl/⌘ V");
  });
});
