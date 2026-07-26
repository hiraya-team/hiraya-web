import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppWindow } from "../src/components/AppWindow";

const base = {
  id: "window",
  title: "Document",
  titleId: "window-title",
  bounds: { x: 0, y: 0, width: 400, height: 300 },
  zIndex: 1,
  focused: true,
  minimized: false,
  segmentActive: true,
  mobile: true,
  onFocus: () => undefined,
  onBoundsChange: () => undefined,
  children: <div>Content</div>,
};

describe("AppWindow mobile actions", () => {
  test("renders mobile actions only when their callbacks exist", () => {
    const none = renderToStaticMarkup(<AppWindow {...base} />);
    expect(none).not.toContain("Back to Desktop");
    expect(none).not.toContain("Switch Window");
    expect(none).not.toContain(">Close<");

    const backOnly = renderToStaticMarkup(<AppWindow {...base} onShowDesktop={() => undefined} />);
    expect(backOnly).toContain("Back to Desktop");
    expect(backOnly).not.toContain("Switch Window");
    expect(backOnly).not.toContain(">Close<");
  });

  test("allows the global mobile shell to suppress duplicate window chrome", () => {
    const markup = renderToStaticMarkup(<AppWindow {...base} hideMobileHeader onShowDesktop={() => undefined} onSwitchWindow={() => undefined} onClose={() => undefined} />);
    expect(markup).not.toContain("app-window__header");
    expect(markup).toContain("Content");
  });

  test("fills the viewport-owned mobile window layer", () => {
    const markup = renderToStaticMarkup(<AppWindow {...base} />);

    expect(markup).toContain("inset:0");
    expect(markup).toContain("width:100%");
    expect(markup).toContain("height:100%");
    expect(markup).not.toContain("height:300px");
  });

  test("routes suppressed mobile header portals to the global shell", () => {
    const actions = {} as HTMLDivElement;
    const markup = renderToStaticMarkup(
      <AppWindow {...base} hideMobileHeader externalHeaderElements={{ leading: null, actions }}>
        {(elements) => <div data-global-actions={elements.actions === actions}>Content</div>}
      </AppWindow>,
    );

    expect(markup).not.toContain("app-window__header");
    expect(markup).toContain('data-global-actions="true"');
  });

  test("renders conventional desktop minimize, maximize, and close controls", () => {
    const markup = renderToStaticMarkup(<AppWindow
      {...base}
      mobile={false}
      onMinimize={() => undefined}
      onToggleMaximize={() => undefined}
      onClose={() => undefined}
    />);
    expect(markup).toContain('aria-label="Minimize Document"');
    expect(markup).toContain('aria-label="Maximize Document"');
    expect(markup).toContain('aria-label="Close Document"');
  });

  test("shows a destination preview without exposing it to interaction", () => {
    const markup = renderToStaticMarkup(<AppWindow {...base} mobile={false} segmentActive={false} segmentVisible />);

    expect(markup).not.toContain("data-segment-hidden");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("inert=\"\"");
  });
});
