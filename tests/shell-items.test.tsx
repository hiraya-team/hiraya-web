import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ShellItemLayer } from "../src/components/ShellItems";
import type { DesktopEntry } from "../src/types";

const folder: DesktopEntry = { id: "folder", kind: "folder", name: "Projects", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 20, y: 30 } };
const child: DesktopEntry = { id: "notes", kind: "file", name: "notes.txt", parentId: folder.id, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "text/plain", size: 4 };

test("renders built-in widgets and folder-backed groups with accessible actions", () => {
  const markup = renderToStaticMarkup(<ShellItemLayer
    widgets={[{ id: "status", kind: "status", x: 300, y: 30, width: 240, height: 140 }]}
    groups={[{ folderId: folder.id, width: 320, height: 240 }]}
    entries={[folder, child]}
    activeSegment={{ column: 0, row: 0 }}
    areaSize={{ width: 1000, height: 700 }}
    status={{ syncStatus: "offline", isSyncing: false, outboxCount: 2, quota: null }}
    gridSize={24}
    selectedEntityIds={new Set(["widget:status"])}
    selectedIds={new Set([child.id])}
    onOpen={() => undefined}
    onSelectEntry={() => undefined}
    onEntryContextMenu={() => undefined}
    onMoveEntry={() => undefined}
    onRemoveWidget={() => undefined}
    onUngroup={() => undefined}
  />);
  expect(markup).toContain("Working offline");
  expect(markup).toContain("2 queued changes");
  expect(markup).toContain("Open in Explorer");
  expect(markup).toContain('aria-label="Remove Status"');
  expect(markup).not.toContain('<header class="shell-item__header"><button class="shell-item__drag" type="button" aria-label="Move Status"');
  expect(markup).toContain('aria-label="Ungroup Projects"');
  expect(markup).toContain('data-entry-drop-parent="folder"');
  expect(markup).toContain('data-item-select=""');
  expect(markup).toContain('data-item-activate=""');
  expect(markup).toContain('data-item-context=""');
  expect(markup).toContain('aria-selected="true"');
  expect(markup).toContain('class="shell-item-snap-preview" aria-hidden="true" data-grid="24"');
  expect(markup).toContain("--snap-grid-size:24px");
});

test("keeps public status generic and only renders the active logical area", () => {
  const hidden = renderToStaticMarkup(<ShellItemLayer widgets={[{ id: "clock", kind: "clock", x: 1200, y: 20, width: 220, height: 150 }]} groups={[]} entries={[]} activeSegment={{ column: 0, row: 0 }} areaSize={{ width: 1000, height: 700 }} readOnly onOpen={() => undefined} />);
  const status = renderToStaticMarkup(<ShellItemLayer widgets={[{ id: "status", kind: "status", x: 20, y: 20, width: 220, height: 150 }]} groups={[]} entries={[]} activeSegment={{ column: 0, row: 0 }} areaSize={{ width: 1000, height: 700 }} readOnly onOpen={() => undefined} />);
  expect(hidden).toBe("");
  expect(status).toContain("Shared desktop");
  expect(status).toContain("Read only");
  expect(status).not.toContain("queued");
  expect(status).not.toContain("data-entry-drop-parent");
});

test("renders permanent widget and icon group geometry outside the current area", () => {
  const markup = renderToStaticMarkup(<ShellItemLayer
    widgets={[{ id: "clock", kind: "clock", x: 350, y: 30, width: 500, height: 200 }]}
    groups={[{ folderId: folder.id, width: 480, height: 240 }]}
    entries={[{ ...folder, position: { x: 360, y: 280 } }]}
    activeSegment={{ column: 0, row: 0 }}
    areaSize={{ width: 390, height: 600 }}
    readOnly
    onOpen={() => undefined}
  />);
  expect(markup).toContain("--shell-x:350px;--shell-y:30px;width:500px;height:200px");
  expect(markup).toContain("--shell-x:360px;--shell-y:280px;width:480px;height:240px");
});

test("gives linked widgets safe selection and activation surfaces", () => {
  const markup = renderToStaticMarkup(<ShellItemLayer widgets={[{ id: "todo", kind: "todo", fileId: "list", x: 20, y: 20, width: 340, height: 300 }]} groups={[]} entries={[]} activeSegment={{ column: 0, row: 0 }} areaSize={{ width: 1000, height: 700 }} onOpen={() => undefined} onActivateWidget={() => undefined} renderWidget={() => <button type="button">Open list</button>} />);
  expect(markup).toContain("shell-item--interactive");
  expect(markup).toContain("Open list");
  expect(markup).toContain('aria-label="Move Todo list"');
  expect(markup).toContain('data-widget-kind="todo"');
});

test("gives an unselected Scene a visible selection grip", () => {
  const markup = renderToStaticMarkup(<ShellItemLayer widgets={[{ id: "scene", kind: "scene", fileId: "scene-file", x: 20, y: 20, width: 420, height: 300 }]} groups={[]} entries={[]} activeSegment={{ column: 0, row: 0 }} areaSize={{ width: 1000, height: 700 }} onOpen={() => undefined} renderWidget={() => <iframe title="Scene widget" />} />);
  expect(markup).toContain('aria-label="Select Scene"');
  expect(markup).toContain('class="shell-item__widget-grip-icon"');
  expect(markup).toContain('aria-pressed="false"');
});
