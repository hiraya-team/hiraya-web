import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AllWindowsPanel } from "../src/components/AllWindowsPanel";

describe("AllWindowsPanel", () => {
  test("groups windows by area and identifies the focused window", () => {
    const markup = renderToStaticMarkup(<AllWindowsPanel
      windows={[
        { id: "notes", title: "Notes", areaId: "0:0", areaLabel: "Home" },
        { id: "files", title: "Files", areaId: "1:0", areaLabel: "Right of Home", minimized: true },
      ]}
      activeAreaId="0:0"
      focusedWindowId="notes"
      onFocusWindow={() => undefined}
      onNavigateArea={() => undefined}
    />);

    expect(markup).toContain("2 open windows across 2 areas");
    expect(markup).toContain("Home");
    expect(markup).toContain("Right of Home");
    expect(markup).toMatch(/aria-current="true"[^>]*><svg[^>]*>/);
    expect(markup).toContain("Current area");
    expect(markup).toContain("Go to area");
  });
});
