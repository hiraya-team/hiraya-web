import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppPickerDialog } from "../src/components/AppPickerDialog";
import type { DialogRequest } from "../src/apps/host/dialogs";
import type { DesktopEntry } from "../src/types";

const entries: DesktopEntry[] = [
  { id: "projects", kind: "folder", name: "Projects", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
  { id: "archive", kind: "folder", name: "Archive", parentId: "projects", createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
  { id: "text", kind: "file", name: "notes.txt", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "text/plain", size: 10 },
  { id: "cover", kind: "file", name: "cover.png", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "image/png", size: 15 },
  { id: "image", kind: "file", name: "a-very-long-screenshot-name.png", parentId: "projects", createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "image/png", size: 20 },
];

function request(params: Extract<DialogRequest, { kind: "openFile" }>["params"] = {}): Extract<DialogRequest, { kind: "openFile" }> {
  return { id: "dialog", owner: { appId: "test.viewer", instanceId: "one" }, kind: "openFile", params };
}

function render(dialogRequest: Extract<DialogRequest, { kind: "openFile" | "openFolder" | "saveFile" }> = request(), desktopEntries = entries) {
  return renderToStaticMarkup(<AppPickerDialog
    request={dialogRequest}
    entries={desktopEntries}
    onCancel={() => undefined}
    onOpenFiles={() => undefined}
    onOpenFolder={() => undefined}
    onSave={async () => undefined}
  />);
}

describe("app file picker", () => {
  test("renders an expanded desktop root with collapsed nested folders", () => {
    const markup = render();
    expect(markup).toContain('role="group" aria-label="Files"');
    expect(markup).toContain("Desktop");
    expect(markup).toContain("Projects");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('type="radio"');
    expect(markup).toContain("notes.txt");
    expect(markup).not.toContain("a-very-long-screenshot-name.png");
    expect(markup).toContain('disabled=""');
  });

  test("uses checkboxes for multiple selection and filters MIME types", () => {
    const markup = render(request({ multiple: true, mimeTypes: ["image/*"] }));
    expect(markup).toContain("Choose files");
    expect(markup).toContain("0 files selected");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("cover.png");
    expect(markup).toContain("Projects");
    expect(markup).not.toContain("notes.txt");
  });

  test("shows a dedicated empty result state", () => {
    const markup = render(request({ mimeTypes: ["application/pdf"] }));
    expect(markup).toContain('class="app-picker__empty"');
    expect(markup).toContain("No matching files are available.");
    expect(markup).toContain("Projects");
  });

  test("shows only selectable folders for folder and save intents", () => {
    const owner = { appId: "test.viewer", instanceId: "one" };
    const folderMarkup = render({ id: "folder", owner, kind: "openFolder", params: {} });
    expect(folderMarkup).toContain('aria-label="Folders"');
    expect(folderMarkup).toContain('name="picked-folder" checked=""');
    expect(folderMarkup).not.toContain("notes.txt");
    expect(folderMarkup).toContain("Choose folder");

    const saveMarkup = render({ id: "save", owner, kind: "saveFile", params: { suggestedName: "draft.md" } });
    expect(saveMarkup).toContain('value="draft.md"');
    expect(saveMarkup).toContain("Desktop selected");
    expect(saveMarkup).not.toContain("notes.txt");
  });
});
