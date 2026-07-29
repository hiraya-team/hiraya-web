import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppWindow } from "../src/components/AppWindow";

const base = {
  id: "window",
  title: "Document",
  titleId: "window-title",
  zIndex: 1,
  focused: true,
  minimized: false,
  segmentActive: true,
  onFocus: () => undefined,
  children: <div>Content</div>,
};

describe("AppWindow focused surface", () => {
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
      <AppWindow {...base} hideHeader externalHeaderElements={{ leading: null, actions }}>
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

  test("keeps unfocused and off-area apps outside interaction", () => {
    const markup = renderToStaticMarkup(<AppWindow {...base} focused={false} segmentActive={false} segmentVisible />);

    expect(markup).not.toContain("data-segment-hidden");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('inert=""');
  });
});
