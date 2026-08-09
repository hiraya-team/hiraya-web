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
    selectedWidgetId="status"
    onOpen={() => undefined}
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
  expect(markup).toContain('class="shell-item-snap-preview" aria-hidden="true" data-grid="24"');
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
