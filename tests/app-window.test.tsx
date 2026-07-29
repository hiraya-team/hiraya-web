import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppWindow } from "../src/components/AppWindow";

const base = {
  id: "window",
  title: "Document",
  titleId: "window-title",
  bounds: { x: 20, y: 30, width: 640, height: 480 },
  zIndex: 1,
  focused: true,
  minimized: false,
  segmentActive: true,
  windowed: false,
  onFocus: () => undefined,
  onBoundsChange: () => undefined,
  children: <div>Content</div>,
};

describe("AppWindow adaptive presentation", () => {
  test("fills its viewport-owned layer without rendering floating bounds", () => {
    const markup = renderToStaticMarkup(<AppWindow {...base} />);

    expect(markup).toContain("data-full-surface");
    expect(markup).toContain("inset:0");
    expect(markup).toContain("width:100%");
    expect(markup).toContain("height:100%");
  });

  test("suppresses duplicate chrome and routes portals to the global header", () => {
    const actions = {} as HTMLDivElement;
    const markup = renderToStaticMarkup(
      <AppWindow {...base} hideFocusedHeader externalHeaderElements={{ leading: null, actions }}>
        {(elements) => <div data-global-actions={elements.actions === actions}>Content</div>}
      </AppWindow>,
    );

    expect(markup).not.toContain("app-window__header");
    expect(markup).toContain('data-global-actions="true"');
  });

  test("renders header navigation actions only when callbacks exist", () => {
    const markup = renderToStaticMarkup(<AppWindow {...base} onShowDesktop={() => undefined} onSwitchWindow={() => undefined} onClose={() => undefined} />);

    expect(markup).toContain("Back to Desktop");
    expect(markup).toContain("Switch Window");
    expect(markup).toContain(">Close<");
  });

  test("renders logical bounds, title controls, and resize handles when windowed", () => {
    const markup = renderToStaticMarkup(<AppWindow {...base} windowed onMinimize={() => undefined} onToggleMaximize={() => undefined} onClose={() => undefined} />);

    expect(markup).not.toContain("data-full-surface");
    expect(markup).toContain("left:20px");
    expect(markup).toContain("top:30px");
    expect(markup).toContain('aria-label="Minimize Document"');
    expect(markup).toContain('aria-label="Maximize Document"');
    expect(markup).toContain('aria-label="Close Document"');
    expect(markup.match(/data-window-resize=/g)).toHaveLength(8);
  });

  test("keeps unfocused and off-area apps outside interaction", () => {
    const markup = renderToStaticMarkup(<AppWindow {...base} focused={false} segmentActive={false} segmentVisible />);

    expect(markup).not.toContain("data-segment-hidden");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('inert=""');
  });
});
