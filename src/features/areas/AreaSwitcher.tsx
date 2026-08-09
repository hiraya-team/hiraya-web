import type { CSSProperties, MouseEvent, PointerEvent, Ref } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Desktop, Minus, Plus, X } from "@phosphor-icons/react";
import { AppIcon, EntryIcon } from "../../components/VisualPrimitives";
import type { DesktopEntry } from "../../types";
import { adjacentArea } from "../../ui/desktop-areas";
import type { DesktopSegment, ResponsiveDesktop, SurfaceSegment } from "../../ui/desktop-geometry";
import { segmentKey } from "../../ui/desktop-geometry";
import { areaDirectionalLabel, homeRelativeAreaLabel, minimapWindows } from "../../ui/shell";
import type { RunningApp } from "../windows/model";

type AreaSwitcherProps = {
  activeSegment: SurfaceSegment;
  activeSegmentKey: string;
  apps: readonly RunningApp[];
  desktopName: string;
  navigationLabel?: string;
  desktopSize: { width: number; height: number };
  detailed: boolean;
  dirtyAppIds: ReadonlySet<string>;
  focusedApp: RunningApp | undefined;
  focusedAppId: string | null;
  obscured: boolean;
  occupiedSegmentKeys: ReadonlySet<string>;
  positions: ResponsiveDesktop["positions"];
  rootRef: Ref<HTMLElement>;
  segments: readonly DesktopSegment[];
  swipePreview: SurfaceSegment | null;
  windowLimit: number;
  getAppEntry: (app: RunningApp) => DesktopEntry | null;
  getAppLabel: (app: RunningApp) => string;
  getAppSegment: (app: RunningApp) => SurfaceSegment;
  onBeginGridSwipe: (event: PointerEvent<HTMLDivElement>) => void;
  onMoveGridSwipe: (event: PointerEvent<HTMLDivElement>) => void;
  onFinishGridSwipe: (event: PointerEvent<HTMLDivElement>, cancelled?: boolean) => void;
  onSelectArea: (segment: SurfaceSegment, event: MouseEvent<HTMLButtonElement>) => void;
  onFocusApp: (id: string) => void;
  onShowDesktop: () => void;
  onMinimizeApp: (id: string) => void;
  onCloseApp: (id: string) => void;
};

export function AreaSwitcher({
  activeSegment,
  activeSegmentKey,
  apps,
  desktopName,
  navigationLabel,
  desktopSize,
  detailed,
  dirtyAppIds,
  focusedApp,
  focusedAppId,
  obscured,
  occupiedSegmentKeys,
  positions,
  rootRef,
  segments,
  swipePreview,
  windowLimit,
  getAppEntry,
  getAppLabel,
  getAppSegment,
  onBeginGridSwipe,
  onMoveGridSwipe,
  onFinishGridSwipe,
  onSelectArea,
  onFocusApp,
  onShowDesktop,
  onMinimizeApp,
  onCloseApp,
}: AreaSwitcherProps) {
  const visibleWindows = minimapWindows(
    apps.map((app) => ({ app, id: app.id, areaId: segmentKey(getAppSegment(app)), focused: focusedAppId === app.id })),
    activeSegmentKey,
    windowLimit,
  );
  const focusedLabel = focusedApp ? getAppLabel(focusedApp) : "";
  const columns = segments.map(({ segment }) => segment.column);
  const rows = segments.map(({ segment }) => segment.row);
  const minColumn = Math.min(...columns);
  const minRow = Math.min(...rows);
  const columnCount = Math.max(...columns) - minColumn + 1;
  const rowCount = Math.max(...rows) - minRow + 1;
  const directions = [
    { direction: "up", Icon: ArrowUp },
    { direction: "right", Icon: ArrowRight },
    { direction: "down", Icon: ArrowDown },
    { direction: "left", Icon: ArrowLeft },
  ] as const;

  return (
    <nav id="area-switcher" ref={rootRef} className="desktop-minimap" data-expanded={detailed || undefined} data-open-apps={apps.length > 0 || undefined} data-obscured={obscured || undefined} aria-label={navigationLabel ?? `${desktopName} areas and open apps`}>
      <div className="desktop-minimap__body" aria-hidden={!detailed} inert={!detailed ? true : undefined}>
        {apps.length > 0 && <header className="desktop-minimap__header">
          <div className="desktop-minimap__header-tools">
            <div className="desktop-minimap__apps" role="group" aria-label="Open apps">
              {visibleWindows.map(({ app }) => {
                const label = getAppLabel(app);
                return <button className="desktop-minimap__app" data-active={(focusedAppId === app.id && !app.minimized) || undefined} data-minimized={app.minimized || undefined} data-dirty={dirtyAppIds.has(app.id) || undefined} data-other-area={segmentKey(getAppSegment(app)) !== activeSegmentKey || undefined} type="button" key={app.id} title={label} aria-label={`Switch to ${label}`} aria-pressed={focusedAppId === app.id && !app.minimized} onClick={() => onFocusApp(app.id)}><AppIcon kind={app.kind} entry={getAppEntry(app)} size={22} /></button>;
              })}
            </div>
            {focusedApp && !focusedApp.minimized && <div className="desktop-minimap__window-controls" role="group" aria-label={`Window controls for ${focusedLabel}`}>
              <span className="desktop-minimap__window-target" title={focusedLabel}><AppIcon kind={focusedApp.kind} entry={getAppEntry(focusedApp)} size={18} /><span>{focusedLabel}</span></span>
              <button type="button" onClick={onShowDesktop} title="Back to desktop" aria-label="Back to desktop"><Desktop size={15} /></button>
              <button type="button" onClick={() => onMinimizeApp(focusedApp.id)} title={`Minimize ${focusedLabel}`} aria-label={`Minimize ${focusedLabel}`}><Minus size={15} /></button>
              <button className="desktop-minimap__window-close" type="button" onClick={() => onCloseApp(focusedApp.id)} title={`Close ${focusedLabel}`} aria-label={`Close ${focusedLabel}`}><X size={15} /></button>
            </div>}
          </div>
        </header>}
        <div className="desktop-minimap__navigator">
          <div className="desktop-minimap__preview desktop-minimap__grid-viewport" onPointerDown={onBeginGridSwipe} onPointerMove={onMoveGridSwipe} onPointerUp={onFinishGridSwipe} onPointerCancel={(event) => onFinishGridSwipe(event, true)}>
            <div className="desktop-minimap__grid" style={{ "--desktop-area-height": desktopSize.height, "--desktop-area-width": desktopSize.width, "--minimap-columns": columnCount, "--minimap-rows": rowCount } as CSSProperties}>
              {segments.map((desktopSegment, visibleIndex) => {
                const currentSegmentKey = desktopSegment.key;
                const isActive = currentSegmentKey === activeSegmentKey;
                const isOccupied = occupiedSegmentKeys.has(currentSegmentKey);
                const hiddenEntryCount = Math.max(0, desktopSegment.entries.length - 6);
                return <div className="desktop-minimap__slot" data-segment-key={isOccupied ? currentSegmentKey : undefined} key={currentSegmentKey} style={{ gridColumn: desktopSegment.segment.column - minColumn + 1, gridRow: desktopSegment.segment.row - minRow + 1 }}>
                  <button className="desktop-minimap__area" data-active={isActive || undefined} data-preview={(currentSegmentKey === segmentKey(swipePreview ?? activeSegment) && !isActive) || undefined} data-home={currentSegmentKey === segmentKey({ column: 0, row: 0 }) || undefined} data-occupied={isOccupied || undefined} type="button" aria-label={`${homeRelativeAreaLabel(desktopSegment.segment)}, area ${visibleIndex + 1} of ${segments.length}${isActive ? ", current area" : ""}${isOccupied ? "" : ", empty"}`} aria-current={isActive ? "true" : undefined} onClick={(event) => onSelectArea(desktopSegment.segment, event)} onContextMenu={(event) => event.preventDefault()}>
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
          {directions.map(({ direction, Icon }) => {
            const target = adjacentArea(activeSegment, direction);
            const targetKey = segmentKey(target);
            const occupied = occupiedSegmentKeys.has(targetKey);
            return <button className="desktop-minimap__direction" data-direction={direction} data-occupied={occupied || undefined} type="button" key={direction} aria-label={`${occupied ? "Go to" : "Add"} ${areaDirectionalLabel(target, activeSegment)} area`} onClick={(event) => onSelectArea(target, event)}><Icon className="desktop-minimap__direction-arrow" size={18} /><Plus className="desktop-minimap__direction-plus" size={22} /></button>;
          })}
        </div>
      </div>
      <span className="visually-hidden">
        {desktopName}, area {Math.max(1, segments.findIndex((candidate) => candidate.key === activeSegmentKey) + 1)} of {segments.length}
      </span>
    </nav>
  );
}
