import type { MouseEvent, PointerEvent, Ref } from "react";
import { ArrowsIn, ArrowsOut, Minus, X } from "@phosphor-icons/react";
import { AppIcon, EntryIcon } from "../../components/VisualPrimitives";
import type { DesktopEntry } from "../../types";
import type { DesktopSegment, ResponsiveDesktop, SurfaceSegment } from "../../ui/desktop-geometry";
import { segmentKey } from "../../ui/desktop-geometry";
import { areaDirectionalLabel, homeRelativeAreaLabel, minimapWindows } from "../../ui/shell";
import type { RunningApp } from "../windows/model";

type AreaSwitcherProps = {
  activeSegment: SurfaceSegment;
  activeSegmentKey: string;
  apps: readonly RunningApp[];
  desktopName: string;
  desktopSize: { width: number; height: number };
  detailed: boolean;
  dirtyAppIds: ReadonlySet<string>;
  focusedApp: RunningApp | undefined;
  focusedAppId: string | null;
  handleRef: Ref<HTMLButtonElement>;
  isMobile: boolean;
  obscured: boolean;
  occupiedSegmentKeys: ReadonlySet<string>;
  positions: ResponsiveDesktop["positions"];
  rootRef: Ref<HTMLElement>;
  segments: readonly DesktopSegment[];
  minColumn: number;
  minRow: number;
  columnCount: number;
  rowCount: number;
  swipePreview: SurfaceSegment | null;
  windowLimit: number;
  getAppEntry: (app: RunningApp) => DesktopEntry | null;
  getAppLabel: (app: RunningApp) => string;
  getAppSegment: (app: RunningApp) => SurfaceSegment;
  isAppMaximized: (app: RunningApp) => boolean;
  onBeginDrag: (event: PointerEvent<HTMLButtonElement>, expanded: boolean) => void;
  onMoveDrag: (event: PointerEvent<HTMLButtonElement>) => void;
  onFinishDrag: (event: PointerEvent<HTMLButtonElement>, cancelled?: boolean) => void;
  onToggle: () => void;
  onBeginGridSwipe: (event: PointerEvent<HTMLDivElement>) => void;
  onMoveGridSwipe: (event: PointerEvent<HTMLDivElement>) => void;
  onFinishGridSwipe: (event: PointerEvent<HTMLDivElement>, cancelled?: boolean) => void;
  onSelectArea: (segment: SurfaceSegment, event: MouseEvent<HTMLButtonElement>) => void;
  onFocusApp: (id: string) => void;
  onMinimizeApp: (id: string) => void;
  onToggleMaximizeApp: (id: string) => void;
  onCloseApp: (id: string) => void;
  onShowAllWindows: () => void;
};

export function AreaSwitcher({
  activeSegment,
  activeSegmentKey,
  apps,
  desktopName,
  desktopSize,
  detailed,
  dirtyAppIds,
  focusedApp,
  focusedAppId,
  handleRef,
  isMobile,
  obscured,
  occupiedSegmentKeys,
  positions,
  rootRef,
  segments,
  minColumn,
  minRow,
  columnCount,
  rowCount,
  swipePreview,
  windowLimit,
  getAppEntry,
  getAppLabel,
  getAppSegment,
  isAppMaximized,
  onBeginDrag,
  onMoveDrag,
  onFinishDrag,
  onToggle,
  onBeginGridSwipe,
  onMoveGridSwipe,
  onFinishGridSwipe,
  onSelectArea,
  onFocusApp,
  onMinimizeApp,
  onToggleMaximizeApp,
  onCloseApp,
  onShowAllWindows,
}: AreaSwitcherProps) {
  const windowModel = minimapWindows(
    apps.map((app) => ({ app, id: app.id, areaId: segmentKey(getAppSegment(app)), focused: focusedAppId === app.id })),
    activeSegmentKey,
    windowLimit,
  );
  const focusedLabel = focusedApp ? getAppLabel(focusedApp) : "";

  return (
    <nav ref={rootRef} className="desktop-minimap" data-mobile={isMobile || undefined} data-expanded={detailed || undefined} data-open-apps={apps.length > 0 || undefined} data-obscured={obscured || undefined} aria-label={`${desktopName} areas and open apps`}>
      <button ref={handleRef} className="desktop-minimap__handle" type="button" aria-label={`${detailed ? "Collapse" : "Open"} area switcher, current area ${homeRelativeAreaLabel(activeSegment)}`} aria-expanded={detailed} onClick={onToggle} onPointerDown={(event) => onBeginDrag(event, detailed)} onPointerMove={onMoveDrag} onPointerUp={onFinishDrag} onPointerCancel={(event) => onFinishDrag(event, true)}>
        <span aria-hidden="true" />
      </button>
      <div className="desktop-minimap__body" aria-hidden={!detailed} inert={!detailed ? true : undefined}>
        {apps.length > 0 && <header className="desktop-minimap__header">
          <div className="desktop-minimap__header-tools">
            <div className="desktop-minimap__apps" role="group" aria-label="Open apps">
              {windowModel.visible.map(({ app }) => {
                const label = getAppLabel(app);
                return <button className="desktop-minimap__app" data-active={(focusedAppId === app.id && !app.minimized) || undefined} data-minimized={app.minimized || undefined} data-dirty={dirtyAppIds.has(app.id) || undefined} data-other-area={segmentKey(getAppSegment(app)) !== activeSegmentKey || undefined} type="button" key={app.id} title={label} aria-label={`Switch to ${label}`} aria-pressed={focusedAppId === app.id && !app.minimized} onClick={() => onFocusApp(app.id)}><AppIcon kind={app.kind} entry={getAppEntry(app)} size={22} /></button>;
              })}
              {windowModel.overflow.length > 0 && <button className="desktop-minimap__app desktop-minimap__app--overflow" type="button" title="All open apps" onClick={onShowAllWindows} aria-label={`${windowModel.overflow.length} more open apps`}>+{windowModel.overflow.length}</button>}
            </div>
            {focusedApp && !focusedApp.minimized && <div className="desktop-minimap__window-controls" role="group" aria-label={`Window controls for ${focusedLabel}`}>
              <span className="desktop-minimap__window-target" title={focusedLabel}><AppIcon kind={focusedApp.kind} entry={getAppEntry(focusedApp)} size={18} /><span>{focusedLabel}</span></span>
              <button type="button" onClick={() => onMinimizeApp(focusedApp.id)} title={`Minimize ${focusedLabel}`} aria-label={`Minimize ${focusedLabel}`}><Minus size={15} /></button>
              {!isMobile && <button type="button" onClick={() => onToggleMaximizeApp(focusedApp.id)} title={`${isAppMaximized(focusedApp) ? "Restore" : "Maximize"} ${focusedLabel}`} aria-label={`${isAppMaximized(focusedApp) ? "Restore" : "Maximize"} ${focusedLabel}`}>{isAppMaximized(focusedApp) ? <ArrowsIn size={15} /> : <ArrowsOut size={15} />}</button>}
              <button className="desktop-minimap__window-close" type="button" onClick={() => onCloseApp(focusedApp.id)} title={`Close ${focusedLabel}`} aria-label={`Close ${focusedLabel}`}><X size={15} /></button>
            </div>}
          </div>
        </header>}
        <div className="desktop-minimap__grid-viewport" onPointerDown={onBeginGridSwipe} onPointerMove={onMoveGridSwipe} onPointerUp={onFinishGridSwipe} onPointerCancel={(event) => onFinishGridSwipe(event, true)}>
          <div className="desktop-minimap__grid" style={{ "--desktop-area-height": desktopSize.height, "--desktop-area-width": desktopSize.width, "--minimap-columns": columnCount, "--minimap-rows": rowCount } as React.CSSProperties}>
            {segments.map((desktopSegment, visibleIndex) => {
              const column = desktopSegment.segment.column - minColumn;
              const row = desktopSegment.segment.row - minRow;
              const currentSegmentKey = desktopSegment.key;
              const isOccupiedSegment = occupiedSegmentKeys.has(currentSegmentKey);
              const hiddenEntryCount = Math.max(0, desktopSegment.entries.length - 6);
              return <div className="desktop-minimap__slot" data-segment-key={isOccupiedSegment ? currentSegmentKey : undefined} key={currentSegmentKey} style={{ gridColumn: column + 1, gridRow: row + 1 }}>
                <button className="desktop-minimap__area" data-active={currentSegmentKey === activeSegmentKey || undefined} data-preview={(currentSegmentKey === segmentKey(swipePreview ?? activeSegment) && currentSegmentKey !== activeSegmentKey) || undefined} data-home={currentSegmentKey === segmentKey({ column: 0, row: 0 }) || undefined} data-occupied={isOccupiedSegment || undefined} type="button" aria-label={`${homeRelativeAreaLabel(desktopSegment.segment)}, area ${visibleIndex + 1} of ${segments.length}${currentSegmentKey === activeSegmentKey ? ", current area" : ""}${isOccupiedSegment ? "" : ", empty"}`} aria-current={currentSegmentKey === activeSegmentKey ? "true" : undefined} onClick={(event) => onSelectArea(desktopSegment.segment, event)} onContextMenu={(event) => event.preventDefault()}>
                  <span className="desktop-minimap__area-title"><strong>{areaDirectionalLabel(desktopSegment.segment, activeSegment)}</strong><small>{desktopSegment.entries.length || "Empty"}</small></span>
                  {desktopSegment.entries.slice(0, 6).map((entry) => {
                    const position = positions.get(entry.id) ?? entry.position;
                    return <span className="desktop-minimap__file" key={entry.id} title={entry.name} style={{ left: `${Math.min(92, Math.max(8, position.x / desktopSize.width * 100))}%`, top: `${Math.min(78, Math.max(24, position.y / desktopSize.height * 100))}%` }}><EntryIcon entry={entry} size={18} /></span>;
                  })}
                  {hiddenEntryCount > 0 && <span className="desktop-minimap__area-overflow">+{hiddenEntryCount}</span>}
                </button>
              </div>;
            })}
          </div>
        </div>
      </div>
      <span className="visually-hidden">
        {desktopName}, area {Math.max(1, segments.findIndex((candidate) => candidate.key === activeSegmentKey) + 1)} of {segments.length}
      </span>
    </nav>
  );
}
