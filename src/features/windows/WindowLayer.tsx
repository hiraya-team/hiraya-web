import { useSyncExternalStore, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { DotsThree } from "@phosphor-icons/react";
import type { CommandId } from "../../apps/commands";
import { builtinAppWindow } from "../../apps/registry";
import { AppWindow, type AppWindowHeaderElements, type AppWindowProps } from "../../components/AppWindow";
import { MobileHeaderMenu } from "../../components/MobileHeaderMenu";
import { areaWorldOrigin } from "../../ui/area-camera";
import { projectLogicalPosition, segmentKey, type SurfaceSegment } from "../../ui/desktop-geometry";
import { MERGE_APP_WINDOW, type RunningApp } from "./model";

type DesktopSize = { width: number; height: number };
type WindowCallbacks = Pick<AppWindowProps, "onFocus" | "onBoundsChange" | "dragEdgeAt" | "onDragAtEdge" | "onEdgeDwellChange" | "onDragEnd" | "onMinimize" | "onClose" | "onToggleMaximize" | "onShowDesktop">;

type WindowLayerProps = WindowCallbacks & {
  apps: readonly RunningApp[];
  activeSegment: SurfaceSegment;
  desktopSize: DesktopSize;
  focusedAppId: string | null;
  windowed: boolean;
  mobileHeaderActionsElement: HTMLDivElement | null;
  restingCamera: { x: number; y: number };
  trackRef: Ref<HTMLDivElement>;
  transitionSegmentKeys: ReadonlySet<string>;
  titleForApp: (app: RunningApp) => string;
  isMaximized: (app: RunningApp) => boolean;
  onExecuteCommand: (id: CommandId) => void;
  onSwitchWindow: () => void;
  children: (app: RunningApp, headerElements: AppWindowHeaderElements) => ReactNode;
};

export function WindowLayer({ apps, activeSegment, desktopSize, focusedAppId, windowed, mobileHeaderActionsElement, restingCamera, trackRef, transitionSegmentKeys, titleForApp, isMaximized, onExecuteCommand, onSwitchWindow, children, ...windowCallbacks }: WindowLayerProps) {
  return <div className="desktop-area-stage desktop-area-stage--windows">
    <div
      className={`app-window-layer${windowed ? " desktop-area-track" : ""}`}
      ref={trackRef}
      role="region"
      aria-label="Open windows"
      style={windowed ? { width: desktopSize.width, height: desktopSize.height, transform: `translate3d(var(--area-track-x, ${restingCamera.x}px), var(--area-track-y, ${restingCamera.y}px), 0)` } : undefined}
    >
      {apps.map((app, index) => {
        const projection = projectLogicalPosition(app.bounds, desktopSize);
        const segmentActive = projection.segment.column === activeSegment.column && projection.segment.row === activeSegment.row;
        const segmentVisible = segmentActive || transitionSegmentKeys.has(segmentKey(projection.segment));
        const localBounds = windowed ? { ...app.bounds, ...projection.local } : { x: 0, y: 0, width: desktopSize.width, height: desktopSize.height };
        const origin = areaWorldOrigin(projection.segment, desktopSize);
        const titleId = `running-app-title-${index}`;
        const title = titleForApp(app);
        const maximized = isMaximized(app);
        const integrated = !windowed || maximized;
        const appWindow = app.kind === "sandbox" ? (app.package.manifest.window ?? { minWidth: 360, minHeight: 260 }) : app.kind === "merge" ? MERGE_APP_WINDOW : builtinAppWindow(app.kind);
        return <div className="desktop-window-segment" key={app.id} style={windowed ? { left: origin.x, top: origin.y, width: desktopSize.width, height: desktopSize.height } : undefined}>
          <AppWindow
            {...windowCallbacks}
            id={app.id}
            title={title}
            titleId={titleId}
            bounds={localBounds}
            minWidth={appWindow.minWidth}
            minHeight={appWindow.minHeight}
            zIndex={app.zIndex}
            focused={focusedAppId === app.id}
            minimized={app.minimized}
            segmentActive={segmentActive}
            segmentVisible={windowed ? segmentVisible : segmentActive}
            windowed={windowed}
            hideFocusedHeader={integrated}
            externalHeaderElements={integrated && focusedAppId === app.id ? { leading: null, actions: mobileHeaderActionsElement } : undefined}
            maximized={maximized}
            onSwitchWindow={onSwitchWindow}
            titleArea={<h2 id={titleId}>{title}</h2>}
          >
            {(headerElements) => <>
              {app.kind === "sandbox" && <RuntimeAppActions app={app} target={headerElements.actions} onExecute={onExecuteCommand} />}
              {children(app, headerElements)}
            </>}
          </AppWindow>
        </div>;
      })}
    </div>
  </div>;
}

export function RuntimeAppActions({ app, target, onExecute }: { app: Extract<RunningApp, { kind: "sandbox" }>; target: HTMLDivElement | null; onExecute: (id: CommandId) => void }) {
  const commands = useSyncExternalStore(app.commands.subscribe, app.commands.getPromoted, app.commands.getPromoted);
  const primary = commands.at(-1);
  if (!target || !primary) return null;
  const appName = app.package.manifest.name;
  const secondary = commands.slice(Math.max(0, commands.length - 3), -1);
  const directCommandIds = new Set(secondary.map(({ id }) => id));
  return createPortal(
    <div className="runtime-app-actions" aria-label={`${appName} actions`}>
      {secondary.map((command) => <button className="runtime-app-action runtime-app-action--secondary" type="button" key={command.id} disabled={!command.enabled} title={command.shortcut ? `${command.title} (${command.shortcut})` : command.title} onClick={() => onExecute(command.id)}>{command.title}</button>)}
      <button className="runtime-app-action runtime-app-action--primary" type="button" disabled={!primary.enabled} title={primary.shortcut ? `${primary.title} (${primary.shortcut})` : primary.title} onClick={() => onExecute(primary.id)}>{primary.title}</button>
      {commands.length > 1 && <div className="runtime-app-actions__overflow" data-always={commands.length > 3 || undefined}>
        <MobileHeaderMenu label={`More ${appName} actions`} icon={<><DotsThree size={18} /><span className="chrome-menu-label">More</span></>}>
          {(dismiss) => commands.slice(0, -1).map((command) => <button type="button" key={command.id} data-direct={directCommandIds.has(command.id) || undefined} disabled={!command.enabled} onClick={() => { dismiss(); onExecute(command.id); }}>{command.title}{command.shortcut && <kbd>{command.shortcut}</kbd>}</button>)}
        </MobileHeaderMenu>
      </div>}
    </div>,
    target,
  );
}
