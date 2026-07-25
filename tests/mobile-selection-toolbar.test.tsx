import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileSelectionToolbar } from "../src/components/MobileSelectionToolbar";

describe("MobileSelectionToolbar", () => {
  test("marks ordinary selections without presenting selection mode", () => {
    const markup = renderToStaticMarkup(<MobileSelectionToolbar count={1}><button type="button">Copy</button></MobileSelectionToolbar>);

    expect(markup).toContain('aria-label="Actions for 1 selected item"');
    expect(markup).toContain('mobile-selection-toolbar__count');
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
});
