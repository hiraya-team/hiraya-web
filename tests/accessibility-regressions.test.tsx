import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FileIcon } from "../src/components/FileIcon";
import { SearchCommandPalette } from "../src/components/SearchCommandPalette";
import { indexSearchBreadcrumbs } from "../src/ui/search-breadcrumbs";

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
  apps: [],
  windows: [],
  commands: [],
  onOpenEntry: () => undefined,
  onLaunchApp: () => undefined,
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

  test("search exposes installed apps and disables unavailable packages", () => {
    const markup = renderToStaticMarkup(<SearchCommandPalette {...baseProps} apps={[
      { id: "app.hiraya.text-editor", name: "Text Editor", source: "system", available: true },
      { id: "example.missing", name: "Missing App", source: "desktop", available: false },
    ]} />);

    expect(markup).toContain('role="group" aria-label="Apps"');
    expect(markup).toContain("Text Editor");
    expect(markup).toMatch(/<button[^>]+aria-disabled="true"[^>]+disabled=""[^>]*>[^<]*<svg[^>]*>/);
    expect(markup).toContain("Missing App");
    expect(markup).toContain("Package unavailable");
  });

  test("indexes search breadcrumbs once for the complete entry tree", () => {
    const entries = [
      { kind: "folder" as const, id: "plans", name: "Plans", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
      { kind: "folder" as const, id: "current", name: "Current", parentId: "plans", createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
      { kind: "file" as const, id: "brief", name: "brief.md", parentId: "current", createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "text/markdown", size: 1 },
    ];

    expect([...indexSearchBreadcrumbs(entries)]).toEqual([
      ["plans", []],
      ["current", ["Plans"]],
      ["brief", ["Plans", "Current"]],
    ]);
  });

  test("guards Markdown link results and rejections by request generation", async () => {
    const source = await Bun.file(new URL("../src/components/MarkdownRenderer.tsx", import.meta.url)).text();

    expect(source).toContain("const generation = ++linkGenerationRef.current;");
    expect(source.match(/linkGenerationRef\.current !== generation/g)).toHaveLength(2);
  });

  test("mobile shell controls retain fixed 44px targets in the final override", async () => {
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();
    const finalMobileRules = css.slice(css.indexOf("/* Final ownership for cohesion-specific responsive behavior. */"));

    expect(finalMobileRules).toContain("width: var(--touch-target); min-width: var(--touch-target); flex: 0 0 var(--touch-target)");
    expect(finalMobileRules).not.toContain("width: 42px; min-width: 42px");
  });

  test("focused surfaces retain explicit authenticated and public action slots", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const publicDesktop = await Bun.file(new URL("../src/PublicDesktop.tsx", import.meta.url)).text();
    const windowLayer = await Bun.file(new URL("../src/features/windows/WindowLayer.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

    expect(app).toContain('className="mobile-global-actions"');
    expect(windowLayer).toContain("externalHeaderElements={focusedAppId === app.id");
    expect(publicDesktop).toContain('className="mobile-global-actions public-menu__window-actions"');
    expect(publicDesktop).toContain("externalHeaderElements={{ leading: null, actions: mobileHeaderActionsElement }}");
    expect(css).toContain("grid-template-columns: var(--touch-target) minmax(0, 1fr) auto var(--touch-target)");
    expect(css).toContain(".mobile-global-actions .image-zoom-control select { min-width: var(--touch-target); height: var(--touch-target); }");
    expect(app).toContain("target.closest(DESKTOP_GESTURE_EXCLUSION_SELECTOR)");
    expect(app).toContain(".app-window, button, a[href], input, select, textarea");
  });

  test("the universal header keeps desktop and temporary area controls distinct", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const areaSwitcher = await Bun.file(new URL("../src/features/areas/AreaSwitcher.tsx", import.meta.url)).text();
    const desktopSwitcher = await Bun.file(new URL("../src/components/DesktopSwitcher.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

    expect(app).toContain("areaSwitcherTriggerRef.current?.focus()");
    expect(app).toContain('event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.code === "Space"');
    expect(app).toContain("areaSwitcherRestoreFocusRef.current = minimapExpanded;");
    expect(app).toContain("setMinimapExpanded(!minimapExpanded);");
    expect(app).toContain('{ id: "area-switcher", group: "Navigation", label: "Toggle area switcher", keys: ["Ctrl", "Space"] }');
    expect(app).toContain("mobileSummary={homeRelativeAreaLabel(activeSegment)}");
    expect(desktopSwitcher).toContain('className="mobile-desktop-switcher"');
    expect(app).toContain('label={`${syncStatus === "offline" ? "Offline; " : syncStatus === "online" && isSyncing ? "Syncing; " : ""}Start; account, system, and windows; ${runningApps.length} open`}');
    expect(app).toContain('className="mobile-start-menu__icon" data-syncing={syncStatus === "online" && isSyncing || undefined} data-offline={syncStatus === "offline" || undefined}');
    expect(css).toContain("@keyframes spin");
    expect(css).toContain(".mobile-start-menu__icon[data-offline] { filter: grayscale(1); opacity: 0.52; }");
    expect(app).toContain('className="mobile-area-switcher-trigger"');
    expect(desktopSwitcher).toContain('aria-label={`Switch desktop, current desktop');
    expect(app).toContain(".desktop-minimap__area[aria-current=\"true\"]");
    expect(areaSwitcher).not.toContain("onBeginDrag");
    expect(areaSwitcher).not.toContain("desktop-minimap__handle");
    expect(areaSwitcher).toContain('className="desktop-minimap__body" aria-hidden={!detailed} inert={!detailed ? true : undefined}');
    expect(app).toContain("if (nextSegment) selectAreaFromSwitcher(nextSegment);");
    expect(app).toContain("collapseAreaMap();");
    expect(app).toContain("onPointerDownCapture={handleShellAreaSwitcherInteraction}");
    expect(app).toContain("if (minimapExpanded && !areaSwitcherContains(event.target)) collapseAreaMap(false);");
    expect(app).toContain("{minimapExpanded && <AreaSwitcher");
    expect(css).toContain("/* The focused-surface shell is canonical at every viewport width. */");
    expect(css).toContain("top: calc(44px + env(safe-area-inset-top) + 8px);");
    expect(css).toContain("visibility: visible;");
    expect(css).toContain("transform: none;");
  });

  test("area switcher exposes canonical focused-app controls", async () => {
    const areaSwitcher = await Bun.file(new URL("../src/features/areas/AreaSwitcher.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

    expect(areaSwitcher).toContain('className="desktop-minimap__window-controls" role="group"');
    expect(areaSwitcher).toContain('data-open-apps={apps.length > 0 || undefined}');
    expect(areaSwitcher).toContain('{apps.length > 0 && <header className="desktop-minimap__header">');
    expect(areaSwitcher).not.toContain("<strong>Areas</strong>");
    expect(areaSwitcher).toContain('aria-label={`Minimize ${focusedLabel}`}');
    expect(areaSwitcher).not.toContain("onToggleMaximizeApp");
    expect(areaSwitcher).toContain('onClick={() => onCloseApp(focusedApp.id)}');
    expect(areaSwitcher).toContain('focusedApp && !focusedApp.minimized');
    expect(css).toContain(".desktop-minimap__window-controls > .desktop-minimap__window-close:hover");
    expect(css).toContain(".desktop-minimap__header-tools { display: flex; width: 100%;");
    expect(css).toContain(".desktop-minimap:not([data-open-apps]) .desktop-minimap__body { padding-top: 0; }");
    expect(css).toContain(".desktop-minimap__handle { display: none; }");
    expect(areaSwitcher).toContain('"--desktop-area-height": desktopSize.height, "--desktop-area-width": desktopSize.width');
    expect(css).toContain("(100cqh - (var(--minimap-rows) - 1) * var(--minimap-gap))");
    expect(css).toContain("(100cqw - (var(--minimap-columns) - 1) * var(--minimap-gap))");
    expect(css).toContain("grid-template-rows: repeat(var(--minimap-rows), minmax(0, 1fr));");
    expect(css).not.toContain(".desktop-minimap__slot { aspect-ratio:");
    expect(css).not.toContain("calc(var(--minimap-columns) * 16) / calc(var(--minimap-rows) * 10)");
    expect(css).not.toContain("calc(var(--minimap-columns) * 15) / calc(var(--minimap-rows) * 10)");
    expect(css).toContain(".desktop-minimap__area:not([data-occupied]):not([data-active])::after {");
    expect(css).toContain('content: "+";');
    expect(css).toContain("height: min(34dvh, 240px);");
    expect(css).toContain("min-height: 52px;");
    expect(css).toContain(".desktop-minimap__header { min-height: 50px; padding-bottom: 6px; }");
    expect(css).toContain(".desktop-minimap__window-target { display: none; }");
    expect(css).toContain(".desktop-minimap__window-controls > button { width: var(--touch-target);");
  });

  test("live area transitions project windowed apps while focused surfaces stay viewport-owned", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const appWindow = await Bun.file(new URL("../src/components/AppWindow.tsx", import.meta.url)).text();
    const windowLayer = await Bun.file(new URL("../src/features/windows/WindowLayer.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

    expect(app).toContain('style.setProperty("--area-track-x"');
    expect(app).toContain('style.removeProperty("--area-track-x")');
    expect(app).toContain("translate3d(var(--area-track-x");
    expect(app).toContain("areaCameraPosition(activeSegment, desktopSize)");
    expect(app).toContain("areaWorldOrigin(desktopSegment.segment, desktopSize)");
    expect(app).not.toContain("segment.column - minColumn");
    expect(windowLayer).toContain('className={`app-window-layer${windowed ? " desktop-area-track" : ""}`}');
    expect(windowLayer).toContain("segmentVisible={windowed ? segmentVisible : segmentActive}");
    expect(windowLayer).toContain("areaWorldOrigin(projection.segment, desktopSize)");
    expect(appWindow).toContain('inset: 0, width: "100%", height: "100%"');
    expect(appWindow).toContain('left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height');
    expect(css).toContain(".app-window-layer.desktop-area-track { right: auto; bottom: auto; overflow: visible; }");
    expect(css).toContain('.desktop[data-area-transition-phase="settling"] .desktop-area-track {');
    expect(css).not.toContain("left calc(260ms * var(--theme-motion))");
  });

  test("viewport resize preserves the signed route and pre-resize window area", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const resizeEffect = app.slice(app.indexOf("const previousDesktopSizeRef"), app.indexOf("if (loading || !windowSessionRestored)"));

    expect(resizeEffect).toContain("projectLogicalPosition(app.bounds, previous)");
    expect(resizeEffect).toContain("restoreLogicalPosition(localBounds, projection.segment, desktopSize)");
    expect(resizeEffect).toContain("if (!windowed");
    expect(resizeEffect).not.toContain("navigateRouteRef.current");
    expect(resizeEffect).not.toContain("selectedEntry");
  });

  test("only the active desktop icon segment is keyboard and accessibility reachable", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const markup = renderToStaticMarkup(<FileIcon
      entry={{ kind: "folder", id: "folder", name: "Plans", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } }}
      selected={false}
      interactive={false}
      onSelect={() => undefined}
      onTouchSelect={() => undefined}
      onOpen={() => undefined}
      onMove={async () => true}
      onDragAtEdge={() => null}
      onDragEnd={() => undefined}
      onContextMenu={() => undefined}
      onContextMenuAt={() => undefined}
    />);

    expect(app).toContain("const segmentActive = desktopSegment.key === activeSegmentKey;");
    expect(app).toContain('data-active={segmentActive || undefined} aria-hidden={!segmentActive || undefined} inert={!segmentActive}');
    expect(app).toContain("interactive={segmentActive}");
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('inert=""');
  });

  test("programmatically activated file inputs are not hidden keyboard stops", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const settings = await Bun.file(new URL("../src/components/SettingsWindow.tsx", import.meta.url)).text();

    expect(app.match(/type="file"\s+tabIndex=\{-1\}\s+aria-hidden="true"/g)).toHaveLength(2);
    expect(settings).toContain('type="file" tabIndex={-1} aria-hidden="true"');
  });

  test("file dialogs restore their invoker or focus the successful result", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const dialog = await Bun.file(new URL("../src/components/FileDialog.tsx", import.meta.url)).text();
    const modal = await Bun.file(new URL("../src/ui/modal-dialog.ts", import.meta.url)).text();

    expect(app).toContain("const openFileDialog = useCallback((next: Exclude<DialogState, null>)");
    expect(app).toContain("fileDialogResultIdRef.current = created.id");
    expect(app).toContain("fileDialogResultIdRef.current = renamed.id");
    expect(app).not.toContain("setDialog({ type:");
    expect(dialog).toContain("useModalDialog(backdropRef, dialogRef, onClose, submitting, restoreFocus)");
    expect(dialog).toContain('aria-invalid={error ? "true" : undefined}');
    expect(dialog).toContain('aria-errormessage={error ? "file-name-error" : undefined}');
    expect(dialog).toContain("requestAnimationFrame(() => nameRef.current?.focus())");
    expect(modal).toContain("restoreFocusRef.current?.() ?? entry.previousFocus");
  });

  test("mobile destination launches suppress menu refocus and establish destination focus", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const menu = await Bun.file(new URL("../src/components/MobileHeaderMenu.tsx", import.meta.url)).text();

    expect(menu).toContain("const dismiss = (restoreFocus = true)");
    expect(menu).toContain("if (restoreFocus) requestAnimationFrame");
    expect(app).toContain("launchMobileDestination(dismiss, () => openSettingsWindow())");
    expect(app).not.toContain("mobileBackButtonRef");
    expect(app).toContain('mobileDestinationOriginRef.current = active?.closest(".mobile-header-menu")');
    expect(app).toContain("return target;");
    expect(app).toContain("onClick={() => { dismiss(); focusApp(window.id); }}");
    expect(app).toContain("restoreFocus={restoreMobileDestinationFocus}");
  });

  test("notifications use a dedicated keyboard-reachable panel", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const notifications = await Bun.file(new URL("../src/features/notifications/ShellNotifications.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

    expect(css).toContain("--layer-popover: 5000");
    expect(app).toContain("messages={shellMessages}");
    expect(app).toContain("syncIssue={syncIssue}");
    expect(app).not.toContain("window.setTimeout(() => setNotice");
    expect(notifications).toContain('aria-haspopup="dialog"');
    expect(notifications).toContain('event.key !== "Escape"');
    expect(notifications).toContain("triggerRef.current?.focus()");
    expect(notifications).toContain('badge="Sync issue"');
    expect(notifications).toContain("Keep local and rebase");
    expect(notifications).toContain("Use server version");
    expect(notifications).toContain("View activity");
    expect(notifications).toContain("Current alerts and actions will appear here.");
    expect(css).toContain(".notification-center__panel");
    expect(css).toContain(".notification-center__footer button");
  });

  test("Getting Started owns one bounded scroll region at constrained heights", async () => {
    const dialog = await Bun.file(new URL("../src/components/GettingStartedDialog.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

    expect(dialog).toContain('className="onboarding-dialog__content"');
    expect(dialog).toContain("dialog.scrollBy({ top: event.deltaY })");
    expect(css).toContain(".onboarding-dialog { display: block;");
    expect(css).toContain("overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y;");
    expect(css).toContain(".onboarding-dialog__content { min-height: 0; }");
    expect(css).toContain(".onboarding-dialog > header { position: sticky;");
  });
});
