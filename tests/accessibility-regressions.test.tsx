import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchCommandPalette } from "../src/components/SearchCommandPalette";

const baseProps = {
  entries: [],
  activeDesktopId: "desktop",
  activeDesktopName: "Desktop",
  activeAuthorityCatalogId: null,
  cachedDesktopResults: [],
  searchAllDesktops: false,
  allDesktopsAvailable: false,
  online: true,
  onSearchAllDesktops: async () => ({
    schemaVersion: 1 as const,
    query: "",
    limit: 50,
    truncated: false,
    results: [],
  }),
  onSearchAllDesktopsChange: () => undefined,
  windows: [],
  commands: [],
  onOpenEntry: () => undefined,
  onFocusWindow: () => undefined,
  onRunCommand: () => undefined,
  onClose: () => undefined,
};

describe("accessibility regressions", () => {
  test("search exposes a list-autocomplete combobox and omits an empty active descendant", () => {
    const markup = renderToStaticMarkup(<SearchCommandPalette {...baseProps} />);

    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-autocomplete="list"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-haspopup="listbox"');
    expect(markup).toContain('role="listbox"');
    expect(markup).not.toContain("aria-activedescendant");
  });

  test("the active descendant references the rendered selected option", () => {
    const entry = {
      kind: "folder" as const,
      id: "folder",
      name: "Plans",
      parentId: null,
      createdAt: 1,
      modifiedAt: 1,
      position: { x: 0, y: 0 },
    };
    const markup = renderToStaticMarkup(<SearchCommandPalette {...baseProps} entries={[entry]} />);
    const activeId = markup.match(/aria-activedescendant="([^"]+)"/)?.[1];

    expect(activeId).toBeTruthy();
    expect(markup).toContain(`id="${activeId}"`);
    expect(markup).toContain(`id="${activeId}" class="command-palette__result" type="button" role="option" aria-selected="true"`);
  });

  test("mobile shell controls retain fixed 44px targets in the final override", async () => {
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();
    const finalMobileRules = css.slice(css.indexOf("/* Final ownership for cohesion-specific responsive behavior. */"));

    expect(finalMobileRules).toContain("width: var(--touch-target); min-width: var(--touch-target); flex: 0 0 var(--touch-target)");
    expect(finalMobileRules).not.toContain("width: 42px; min-width: 42px");
  });

  test("suppressed mobile windows retain explicit authenticated and public action slots", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const publicDesktop = await Bun.file(new URL("../src/PublicDesktop.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

    expect(app).toContain('className="mobile-global-actions"');
    expect(app).toContain("externalHeaderElements={isMobile && focusedAppId === app.id");
    expect(publicDesktop).toContain('className="mobile-global-actions public-menu__window-actions"');
    expect(publicDesktop).toContain("externalHeaderElements={mobile ?");
    expect(css).toContain("grid-template-columns: var(--touch-target) minmax(0, 1fr) auto var(--touch-target)");
    expect(css).toContain(".mobile-global-actions .image-zoom-control select { min-width: var(--touch-target); height: var(--touch-target); }");
  });

  test("mobile switchers use distinct desktop and area controls", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const desktopSwitcher = await Bun.file(new URL("../src/components/DesktopSwitcher.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

    expect(app).toContain("areaSwitcherHandleRef.current?.focus()");
    expect(app).toContain("mobileSummary={homeRelativeAreaLabel(activeSegment)}");
    expect(app).not.toContain("<MapTrifold /> Expand Area Map");
    expect(desktopSwitcher).toContain('className="mobile-desktop-switcher"');
    expect(desktopSwitcher).toContain('aria-label={`Switch desktop, current desktop');
    expect(app).toContain(".desktop-minimap__area[aria-current=\"true\"]");
    expect(app).toContain('aria-expanded={minimapDetailed}');
    expect(app).toContain('className="desktop-minimap__body" aria-hidden={!minimapDetailed} inert={!minimapDetailed ? true : undefined}');
    expect(app).not.toContain('className="desktop-minimap__pull-tab"');
    expect(app).toContain('if (owner === "areaEditor") {');
    expect(app).toContain("if (isMobile) areaSwitcherRestoreFocusRef.current = true;");
    expect(app).toContain("if (drag.expanded) collapseAreaMap();");
    expect(app).toContain("if (nextSegment) selectAreaFromSwitcher(nextSegment);");
    expect(app).not.toContain("if (isMobile) collapseAreaMap();");
    expect(app).not.toContain("if (isMobile) collapseAreaMap(false);");
    expect(app).toContain("onPointerDownCapture={handleShellAreaSwitcherInteraction}");
    expect(app).toContain("onKeyDownCapture={handleShellAreaSwitcherInteraction}");
    expect(app).toContain("onClickCapture={captureAreaSwitcherActivation}");
    expect(app).toContain("onFocusCapture={handleShellAreaSwitcherFocus}");
    expect(app).toContain("areaSwitcherRef.current?.contains(target as Node)");
    expect(app).toContain("if (areaSwitcherInternalActivationRef.current) {");
    expect(app).toContain("if (minimapExpanded && !areaSwitcherContains(event.target)) collapseAreaMap(false);");
    expect(app).toContain('window.addEventListener("blur", dismissForFrameFocus, true)');
    expect(app).toContain("document.activeElement instanceof HTMLIFrameElement");
    expect(css).toContain("calc(100% - 44px + var(--area-switcher-edge-inset))");
    expect(css).toContain(".desktop-minimap[data-dragging] { transition: none; }");
    expect(css).toContain(".mobile-window-nav > .desktop-switcher[data-mobile-summary]");
  });

  test("area switcher exposes breakpoint-appropriate controls for the focused window", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

    expect(app).toContain('className="desktop-minimap__window-controls" role="group"');
    expect(app).toContain('data-open-apps={runningApps.length > 0 || undefined}');
    expect(app).toContain('{runningApps.length > 0 && <header className="desktop-minimap__header">');
    expect(app).not.toContain("<strong>Areas</strong>");
    expect(app).toContain('aria-label={`Minimize ${focusedAppLabel}`}');
    expect(app).toContain('{!isMobile && <button type="button" onClick={() => toggleMaximizeApp(focusedApp.id)}');
    expect(app).toContain('onClick={() => void requestCloseApp(focusedApp.id)}');
    expect(app).toContain('focusedApp && !focusedApp.minimized');
    expect(app).not.toContain('if (isMobile && focusedAppIdRef.current) showDesktop();');
    expect(css).toContain(".desktop-minimap__window-controls > .desktop-minimap__window-close:hover");
    expect(css).toContain(".desktop-minimap__header-tools { display: flex; width: 100%;");
    expect(css).toContain(".desktop-minimap:not([data-open-apps]) .desktop-minimap__body { padding-top: 0; }");
    expect(css).toContain(".desktop-minimap[data-expanded] .desktop-minimap__handle { height: 100%; }");
    expect(css).toContain("height: min(34dvh, 240px);");
    expect(css).toContain("min-height: 52px;");
    expect(css).toContain(".desktop-minimap__header { min-height: 50px; padding-bottom: 6px; }");
    expect(css).toContain(".desktop-minimap__window-target { display: none; }");
    expect(css).toContain(".desktop-minimap__window-controls > button { width: var(--touch-target);");
  });

  test("live area transitions restore canonical tracks and viewport-sized mobile windows", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const appWindow = await Bun.file(new URL("../src/components/AppWindow.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

    expect(app).toContain('style.setProperty("--area-track-x"');
    expect(app).toContain('style.removeProperty("--area-track-x")');
    expect(app).toContain("translate3d(var(--area-track-x");
    expect(appWindow).toContain('width: "100cqw", height: "100cqh"');
    expect(css).toContain("container-type: size;");
  });
});
