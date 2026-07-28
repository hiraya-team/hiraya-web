import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileSelectionToolbar } from "../src/components/MobileSelectionToolbar";

describe("MobileSelectionToolbar", () => {
  test("marks ordinary selections without presenting selection mode", () => {
    const markup = renderToStaticMarkup(<MobileSelectionToolbar count={1} onBeginSelectionMode={() => undefined}><button type="button">Copy</button></MobileSelectionToolbar>);

    expect(markup).toContain('aria-label="Actions for 1 selected item"');
    expect(markup).toContain('mobile-selection-toolbar__count');
    expect(markup).toContain('aria-label="Select multiple items; 1 selected item"');
    expect(markup).toContain('title="Select multiple items"');
    expect(markup).not.toContain("Selecting");
    expect(markup).not.toContain("Done selecting");
  });

  test("announces multiselect mode without presenting an exit control", () => {
    const markup = renderToStaticMarkup(<MobileSelectionToolbar count={3} selectionMode />);

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
      <MobileSelectionToolbar count={0}>
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
});
