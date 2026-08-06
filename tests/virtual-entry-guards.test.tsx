import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FileIcon } from "../src/components/FileIcon";
import { FolderExplorer } from "../src/components/FolderExplorer";
import { isVirtualThumbnailEntry, VIRTUAL_HIRAYA_ROOT_ID } from "../src/ui/shell-entries";
import type { FolderEntry } from "../src/types";

const folder: FolderEntry = { kind: "folder", id: VIRTUAL_HIRAYA_ROOT_ID, name: ".hiraya", parentId: null, createdAt: null, modifiedAt: 1, position: { x: 0, y: 0 } };
const noop = () => undefined;

describe("virtual entry interaction guards", () => {
  test("does not expose virtual desktop folders as drag sources or destinations", () => {
    const html = renderToStaticMarkup(<FileIcon entry={folder} selected={false} readOnly onSelect={noop} onTouchSelect={noop} onOpen={noop} onMove={async () => false} dragEdgeAt={() => null} onDragAtEdge={() => null} onEdgeDwellChange={noop} onDragEnd={noop} onContextMenu={noop} onContextMenuAt={noop} />);
    expect(html).not.toContain("data-entry-drop-parent");
  });

  test("keeps virtual explorer contents read-only and removes virtual row destinations", () => {
    const props = { rootLabel: "Desktop", breadcrumbs: [], onNavigate: noop, onOpen: noop, onCreateFolder: noop, onCreateFile: noop, onUpload: noop, onImportFolder: noop, onExternalDrop: noop, onContextMenu: noop, onBlankContextMenu: noop, selectedIds: new Set<string>(), onSelect: noop, onMove: noop, view: "list" as const, onViewChange: noop, isEntryReadOnly: isVirtualThumbnailEntry };
    const virtual = renderToStaticMarkup(<FolderExplorer {...props} folder={folder} children={[]} readOnly />);
    expect(virtual).not.toContain("data-entry-drop-parent");
    expect(virtual).toContain("disabled");

    const root = renderToStaticMarkup(<FolderExplorer {...props} folder={null} children={[folder]} />);
    expect(root).not.toContain(`data-entry-drop-parent="${VIRTUAL_HIRAYA_ROOT_ID}"`);
  });
});
