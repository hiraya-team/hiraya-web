import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FileIcon } from "../src/components/FileIcon";
import { PanelDialog } from "../src/components/PanelDialog";
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
  test("modal panels and search use shared visible title bars", () => {
    const panel = renderToStaticMarkup(<PanelDialog title="User Guide" onClose={() => undefined}><p>Guide</p></PanelDialog>);
    const search = renderToStaticMarkup(<SearchCommandPalette {...baseProps} />);
    const panelTitleId = panel.match(/aria-labelledby="([^"]+)"/)?.[1];
    const searchTitleId = search.match(/aria-labelledby="([^"]+)"/)?.[1];

    expect(panel).toContain('class="modal-backdrop utility-panel-backdrop"');
    expect(panel).toContain('class="file-window utility-panel-dialog"');
    expect(panel).toContain('class="window-header"');
    expect(panel).toContain(`id="${panelTitleId}">User Guide</h2>`);
    expect(search).toContain('class="window-header"');
    expect(search).toContain(`id="${searchTitleId}">Search</h2>`);
    expect(search).toContain('class="command-palette__search"');
    expect(search).toContain('Search apps, files, folders, windows, and commands');
  });

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
      { id: "app.hiraya.text-editor", name: "Integrated Editor", source: "system", available: true },
      { id: "example.missing", name: "Missing App", source: "desktop", available: false },
    ]} />);

    expect(markup).toContain('role="group" aria-label="Apps"');
    expect(markup).toContain("Integrated Editor");
    expect(markup).toMatch(/<button[^>]+aria-disabled="true"[^>]+disabled=""[^>]*>[^<]*<svg[^>]*>/);
    expect(markup).toContain("Missing App");
    expect(markup).toContain("Package unavailable");
  });

  test("search includes commands without a separate mode", () => {
    const markup = renderToStaticMarkup(<SearchCommandPalette {...baseProps} commands={[
      { id: "desktop.settings", label: "Open Settings", enabled: true },
    ]} />);

    expect(markup).toContain('role="group" aria-label="Commands"');
    expect(markup).toContain("Open Settings");
    expect(markup).not.toContain("> ");
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
    expect(windowLayer).toContain("externalHeaderElements={integrated && focusedAppId === app.id");
    expect(windowLayer).toContain('className="runtime-app-actions"');
    expect(windowLayer).toContain("useSyncExternalStore(app.commands.subscribe");
    expect(windowLayer).toContain('data-direct={directCommandIds.has(command.id) || undefined}');
    expect(windowLayer).toContain('<span className="chrome-menu-label">More</span>');
    expect(app).toContain('<span className="chrome-menu-label">System</span>');
    expect(publicDesktop).toContain('className="mobile-global-actions public-menu__window-actions"');
    expect(publicDesktop).toContain("externalHeaderElements={windowed ? undefined : { leading: null, actions: mobileHeaderActionsElement }}");
    expect(css).toContain("grid-template-columns: var(--touch-target) minmax(0, 1fr) auto var(--touch-target)");
    expect(css).toContain(".mobile-global-actions .image-zoom-control select { min-width: var(--touch-target); height: var(--touch-target); }");
    expect(css).toContain(".runtime-app-action--secondary { display: none; }");
    expect(css).toContain(".runtime-app-actions__overflow [data-direct] { display: none; }");
    expect(css).toContain(".runtime-app-actions__overflow [data-direct] { display: flex; }");
    expect(app).toContain("target.closest(DESKTOP_GESTURE_EXCLUSION_SELECTOR)");
    expect(app).toContain(".app-window, button, a[href], input, select, textarea");
  });

  test("the universal header uses one desktop and area switcher", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const appWindow = await Bun.file(new URL("../src/components/AppWindow.tsx", import.meta.url)).text();
    const areaSwitcher = await Bun.file(new URL("../src/features/areas/AreaSwitcher.tsx", import.meta.url)).text();
    const windowLayer = await Bun.file(new URL("../src/features/windows/WindowLayer.tsx", import.meta.url)).text();
    const desktopSwitcher = await Bun.file(new URL("../src/components/DesktopSwitcher.tsx", import.meta.url)).text();
    const desktopSettings = await Bun.file(new URL("../src/components/DesktopSettings.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

    expect(app).toContain("areaSwitcherTriggerRef.current?.focus()");
    expect(app).toContain('event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.code === "Space"');
    expect(app).toContain("areaSwitcherRestoreFocusRef.current = minimapExpanded;");
    expect(app).toContain("setMinimapExpanded(!minimapExpanded);");
    expect(app).toContain('{ id: "area-switcher", group: "Navigation", label: "Toggle desktop and area switcher", keys: ["Ctrl", "Space"] }');
    expect(app).toContain('className="mobile-desktop-summary" type="button" popoverTarget="desktop-switcher"');
    expect(app).toContain("<DesktopSwitcher desktops={desktopChoices}");
    expect(desktopSwitcher).toContain('className="desktop-switcher__picker" aria-label="Desktops" popover="auto"');
    expect(desktopSwitcher).toContain('className="desktop-switcher__row desktop-switcher__row--switch"');
    expect(desktopSwitcher).toContain('<ItemList items={desktops}');
    expect(desktopSwitcher).not.toContain("onCreate");
    expect(desktopSwitcher).not.toContain("onRename");
    expect(desktopSwitcher).not.toContain("onDelete");
    expect(desktopSwitcher).toContain("desktop.pinned");
    expect(desktopSettings).toContain('<ItemList items={ordered}');
    expect(desktopSettings).toContain("reorderHandleProps");
    expect(desktopSettings).toContain("items[toIndex]?.pinned === desktop.pinned");
    expect(desktopSettings).toContain("Move ${desktop.name} up");
    expect(desktopSettings).toContain("Move ${desktop.name} down");
    expect(desktopSwitcher).not.toContain('aria-haspopup="dialog"');
    expect(desktopSwitcher).toContain("hidePopover()");
    expect(app).toContain('label={`${syncStatus === "offline" ? "Offline; " : syncStatus === "online" && isSyncing ? "Syncing; " : ""}Start; account, system, and applications`}');
    expect(app).toContain('className="mobile-start-applications"');
    expect(app).not.toContain("<SquaresFour /> Switch Window");
    expect(app).not.toContain('setActivePanel("windows")');
    expect(app).not.toContain("AllWindowsPanel");
    expect(app).not.toContain("All windows");
    expect(appWindow).not.toContain("onSwitchWindow");
    expect(areaSwitcher).not.toContain("onShowAllWindows");
    expect(areaSwitcher).not.toContain("All open apps");
    expect(windowLayer).not.toContain("onSwitchWindow");
    expect(app).not.toContain("<Desktop /> Back to Desktop");
    expect(app).not.toContain('className="menu-bar__store"');
    expect(app).toContain('className="mobile-start-menu__icon" data-syncing={syncStatus === "online" && isSyncing || undefined} data-offline={syncStatus === "offline" || undefined}');
    expect(css).toContain("@keyframes spin");
    expect(css).toContain(".mobile-start-menu__icon[data-offline] { filter: grayscale(1); opacity: 0.52; }");
    expect(app).toContain('className="mobile-area-switcher-trigger"');
    expect(app).toContain('aria-label={`${minimapDetailed ? "Collapse" : "Open"} desktop and area switcher');
    expect(app).toContain(".desktop-minimap__area[aria-current=\"true\"]");
    expect(areaSwitcher).not.toContain("onBeginDrag");
    expect(areaSwitcher).not.toContain("desktop-minimap__handle");
    expect(areaSwitcher).not.toContain("desktopRail");
    expect(areaSwitcher).toContain('className="desktop-minimap__grid"');
    expect(areaSwitcher).toContain("segments.map((desktopSegment, visibleIndex)");
    expect(areaSwitcher).toContain('className="desktop-minimap__direction"');
    expect(areaSwitcher).toContain('`${occupied ? "Go to" : "Add"} ${areaDirectionalLabel(target, activeSegment)} area`');
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
    expect(areaSwitcher).toContain('aria-label="Back to desktop"');
    expect(areaSwitcher).not.toContain("onToggleMaximizeApp");
    expect(areaSwitcher).toContain('onClick={() => onCloseApp(focusedApp.id)}');
    expect(areaSwitcher).toContain('focusedApp && !focusedApp.minimized');
    expect(css).toContain(".desktop-minimap__window-controls > .desktop-minimap__window-close:hover");
    expect(css).toContain(".desktop-minimap__header-tools { display: flex; width: 100%;");
    expect(css).toContain(".desktop-minimap:not([data-open-apps]) .desktop-minimap__body { padding-top: 0; }");
    expect(css).toContain(".desktop-minimap__handle { display: none; }");
    expect(areaSwitcher).toContain("adjacentArea(activeSegment, direction)");
    expect(areaSwitcher).toContain('"--minimap-columns": columnCount, "--minimap-rows": rowCount');
    expect(css).toContain("grid-template-columns: 44px minmax(0, 1fr) 44px;");
    expect(css).toContain("grid-template-rows: 44px minmax(140px, 170px) 44px;");
    expect(css).toContain("min-width: var(--touch-target);");
    expect(css).toContain('.desktop-minimap__direction[data-direction="right"]');
    expect(css).toContain(".desktop-minimap__direction-plus");
    expect(css).not.toContain("height: min(54dvh, 430px);");
    expect(css).toContain(".desktop-minimap__window-target { display: none; }");
    expect(css).toContain(".desktop-minimap__window-controls > button { width: 36px;");
    expect(css).toContain(".desktop-switcher__picker:popover-open");
  });

  test("live area transitions project windowed apps while focused surfaces stay viewport-owned", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const appWindow = await Bun.file(new URL("../src/components/AppWindow.tsx", import.meta.url)).text();
    const windowLayer = await Bun.file(new URL("../src/features/windows/WindowLayer.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();
    const shellItemStage = app.slice(app.indexOf('<div className="desktop-area-stage desktop-area-stage--shell-items">'), app.indexOf("{marquee &&"));
    const virtualRootPlacement = app.slice(app.indexOf("const shellEntryList"), app.indexOf("const shellEntryIndex"));

    expect(app).toContain('style.setProperty("--area-track-x"');
    expect(app).toContain('style.setProperty("--icon-area-track-x"');
    expect(app).toContain('style.removeProperty("--area-track-x")');
    expect(app).toContain("translate3d(var(--area-track-x");
    expect(app).toContain("translate3d(var(--icon-area-track-x");
    expect(app).toContain("areaCameraPosition(activeSegment, desktopSize)");
    expect(app).toContain("areaWorldOrigin(desktopSegment.segment, iconArea)");
    expect(app).not.toContain("segment.column - minColumn");
    expect(windowLayer).toContain('className={`app-window-layer${windowed ? " desktop-area-track" : ""}`}');
    expect(windowLayer).toContain("segmentVisible={windowed ? segmentVisible : segmentActive}");
    expect(windowLayer).toContain("areaWorldOrigin(projection.segment, desktopSize)");
    expect(appWindow).toContain('inset: 0, width: "100%", height: "100%"');
    expect(appWindow).toContain('left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height');
    expect(shellItemStage).toContain('className="desktop-canvas desktop-area-track"');
    expect(shellItemStage).toContain("visibleSegments.map((shellSegment)");
    expect(shellItemStage).toContain("areaWorldOrigin(shellSegment.segment, iconArea)");
    expect(shellItemStage).toContain("translate3d(var(--icon-area-track-x");
    expect(shellItemStage).toContain("left: areaTransition ? 0 : iconRestingCamera.x");
    expect(shellItemStage).toContain('transform: areaTransition ? `translate3d');
    expect(shellItemStage).toContain("transitionSegmentKeys.has(shellSegment.key)");
    expect(shellItemStage).toContain("inert={!segmentInteractive}");
    expect(css).toContain(".app-window-layer.desktop-area-track { right: auto; bottom: auto; overflow: visible; }");
    expect(css).toContain('.desktop[data-area-transition-phase="settling"] .desktop-area-track {');
    expect(css).toContain(".desktop[data-area-transitioning] .shell-item { pointer-events: none; }");
    expect(css).toContain(".desktop-area-stage--shell-items .desktop-area-track { transition: none; will-change: auto; }");
    expect(css).toContain(".shell-item--widget .shell-item__content { position: absolute; inset: 0;");
    expect(css).not.toContain("left calc(260ms * var(--theme-motion))");
    expect(app).not.toContain('"--area-stage-scale"');
    expect(css).not.toContain("transform: scale(var(--area-stage-scale");
    expect(css).not.toContain("@keyframes area-stage-switch");
    expect(virtualRootPlacement).toContain("{ column: 0, row: 0 }");
    expect(virtualRootPlacement).not.toContain("activeShellItemObstacles");
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

  test("only the active or actively dragged desktop icon segment is reachable", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const markup = renderToStaticMarkup(<FileIcon
      entry={{ kind: "folder", id: "folder", name: "Plans", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } }}
      selected={false}
      interactive={false}
      onSelect={() => undefined}
      onTouchSelect={() => undefined}
      onOpen={() => undefined}
      onMove={async () => true}
      dragEdgeAt={() => null}
      onDragAtEdge={() => null}
      onEdgeDwellChange={() => undefined}
      onDragEnd={() => undefined}
      onContextMenu={() => undefined}
      onContextMenuAt={() => undefined}
    />);

    expect(app).toContain("const segmentActive = desktopSegment.key === activeSegmentKey;");
    expect(app).toContain("const segmentInteractive = segmentActive || segmentDragging;");
    expect(app).toContain('data-active={segmentActive || undefined} aria-hidden={!segmentInteractive || undefined} inert={!segmentInteractive}');
    expect(app).toContain("interactive={segmentInteractive}");
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('inert=""');
  });

  test("keeps placement previews and Markdown quotes visually restrained", async () => {
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();
    expect(css).not.toContain("snap-preview[data-grid]");
    expect(css).not.toContain("border-left: 3px solid");
    expect(css).toContain("border-inline-start: var(--theme-border-width, 1px) solid");
  });

  test("programmatically activated file inputs are not hidden keyboard stops", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const themeEditor = await Bun.file(new URL("../apps/system/theme-editor/index.html", import.meta.url)).text();

    expect(app.match(/type="file"\s+tabIndex=\{-1\}\s+aria-hidden="true"/g)).toHaveLength(2);
    expect(themeEditor).toContain('id="wallpaper-upload" type="file"');
    expect(themeEditor).toContain('accept="image/jpeg,image/png,image/webp" hidden');
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
    expect(app).toContain("launchMobileDestination(dismiss, () => launchApp(app))");
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
    expect(notifications).toContain("Keep my change");
    expect(notifications).toContain("Use server state");
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
