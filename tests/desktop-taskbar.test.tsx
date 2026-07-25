import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DesktopTaskbar } from "../src/components/DesktopTaskbar";

describe("DesktopTaskbar", () => {
  test("keeps active, minimized, dirty, and cross-area windows discoverable", () => {
    const markup = renderToStaticMarkup(<DesktopTaskbar
      items={[
        { id: "active", title: "Notes", areaLabel: "Current area", icon: <span>N</span>, active: true, minimized: false, dirty: true, otherArea: false },
        { id: "minimized", title: "Files", areaLabel: "Right of Home", icon: <span>F</span>, active: false, minimized: true, dirty: false, otherArea: true },
      ]}
      onShowDesktop={() => undefined}
      onActivate={() => undefined}
    />);

    expect(markup).toContain('aria-label="Show desktop"');
    expect(markup).toContain('aria-label="Minimize Notes, Current area"');
    expect(markup).toContain('data-dirty="true"');
    expect(markup).toContain('aria-label="Open Files, Right of Home"');
    expect(markup).toContain('data-minimized="true"');
    expect(markup).toContain('data-other-area="true"');
  });
});
