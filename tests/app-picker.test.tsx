import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppPickerDialog } from "../src/components/AppPickerDialog";
import type { DialogRequest } from "../src/apps/host/dialogs";
import type { FileEntry } from "../src/types";

const files: FileEntry[] = [
  { id: "text", kind: "file", name: "notes.txt", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "text/plain", size: 10 },
  { id: "image", kind: "file", name: "a-very-long-screenshot-name.png", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "image/png", size: 20 },
];

function request(params: Extract<DialogRequest, { kind: "openFile" }>["params"] = {}): Extract<DialogRequest, { kind: "openFile" }> {
  return { id: "dialog", owner: { appId: "test.viewer", instanceId: "one" }, kind: "openFile", params };
}

function render(entries = files, dialogRequest = request()) {
  return renderToStaticMarkup(<AppPickerDialog
    request={dialogRequest}
    entries={entries}
    onCancel={() => undefined}
    onOpenFiles={() => undefined}
    onOpenFolder={() => undefined}
    onSave={async () => undefined}
  />);
}

describe("app file picker", () => {
  test("renders bounded, labeled single-selection rows", () => {
    const markup = render();
    expect(markup).toContain('role="group" aria-label="Files"');
    expect(markup).toContain('type="radio"');
    expect(markup).toContain('class="app-picker__name" title="a-very-long-screenshot-name.png"');
    expect(markup).toContain("notes.txt");
    expect(markup).toContain('disabled=""');
  });

  test("uses checkboxes for multiple selection and filters MIME types", () => {
    const markup = render(files, request({ multiple: true, mimeTypes: ["image/*"] }));
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("a-very-long-screenshot-name.png");
    expect(markup).not.toContain("notes.txt");
  });

  test("shows a dedicated empty result state", () => {
    const markup = render([], request({ mimeTypes: ["application/pdf"] }));
    expect(markup).toContain('class="app-picker__empty"');
    expect(markup).toContain("No matching files are available.");
  });
});
