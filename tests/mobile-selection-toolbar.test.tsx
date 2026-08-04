import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileSelectionToolbar } from "../src/components/MobileSelectionToolbar";

describe("MobileSelectionToolbar", () => {
  test("marks ordinary selections without presenting selection mode", () => {
    const markup = renderToStaticMarkup(<MobileSelectionToolbar count={1} contentKey="selection-actions" collapsed={false} onBeginSelectionMode={() => undefined} onToggle={() => undefined}><button type="button">Copy</button></MobileSelectionToolbar>);

    expect(markup).toContain('aria-label="Actions for 1 selected item"');
    expect(markup).toContain('mobile-selection-toolbar__count');
    expect(markup).toContain('mobile-selection-toolbar__content');
    expect(markup).toContain('aria-label="Select multiple items; 1 selected item"');
    expect(markup).toContain('title="Select multiple items"');
    expect(markup).toContain('<span>1</span>');
    expect(markup).not.toContain("Selecting");
    expect(markup).not.toContain("Done selecting");
  });

  test("announces multiselect mode without presenting an exit control", () => {
    const markup = renderToStaticMarkup(<MobileSelectionToolbar count={3} contentKey="selection-mode" collapsed={false} selectionMode onToggle={() => undefined} />);

    expect(markup).toContain('aria-label="Selection mode: 3 selected items"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Selecting");
    expect(markup).toContain(">3<");
    expect(markup).not.toContain("Done selecting");
    expect(markup).not.toContain(">Done<");
  });

  test("presents file actions without a selection count when empty", () => {
    const markup = renderToStaticMarkup(
      <MobileSelectionToolbar count={0} contentKey="file-actions" collapsed={false} onToggle={() => undefined}>
        <button type="button" aria-label="New text file">New</button>
        <button type="button" aria-label="Upload files" disabled>Upload</button>
      </MobileSelectionToolbar>,
    );

    expect(markup).toContain('aria-label="File actions"');
    expect(markup).toContain('aria-label="New text file"');
    expect(markup).toContain('aria-label="Upload files"');
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("mobile-selection-toolbar__count");
    expect(markup).not.toContain("Selecting");
  });

  test("toggles file actions and installed app pins together", () => {
    const expanded = renderToStaticMarkup(<MobileSelectionToolbar count={0} contentKey="file-actions" collapsed={false} apps={<button type="button">Text Editor</button>} onToggle={() => undefined}><button type="button">New</button></MobileSelectionToolbar>);
    const collapsed = renderToStaticMarkup(<MobileSelectionToolbar count={0} contentKey="file-actions" collapsed apps={<button type="button">Text Editor</button>} onToggle={() => undefined}><button type="button">New</button></MobileSelectionToolbar>);

    expect(expanded).toContain('role="toolbar" aria-label="Installed apps"');
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain('aria-label="Hide actions and apps"');
    expect(collapsed).toContain('data-collapsed="true"');
    expect(collapsed).toContain('id="installed-app-pins"');
    expect(collapsed).toContain('id="file-action-pins"');
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toContain('aria-label="Show actions and apps"');
    expect(collapsed.match(/ hidden=""/g)).toHaveLength(2);
  });
});
