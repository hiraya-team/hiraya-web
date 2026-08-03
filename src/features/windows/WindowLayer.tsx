import type { ReactNode, Ref } from "react";
import { builtinAppWindow } from "../../apps/registry";
import { AppWindow, type AppWindowHeaderElements, type AppWindowProps } from "../../components/AppWindow";
import { areaWorldOrigin } from "../../ui/area-camera";
import { projectLogicalPosition, segmentKey, type SurfaceSegment } from "../../ui/desktop-geometry";
import { MERGE_APP_WINDOW, type RunningApp } from "./model";

type DesktopSize = { width: number; height: number };
type WindowCallbacks = Pick<AppWindowProps, "onFocus" | "onBoundsChange" | "dragEdgeAt" | "onDragAtEdge" | "onEdgeDwellChange" | "onDragEnd" | "onMinimize" | "onClose" | "onToggleMaximize" | "onMoveArea" | "onAdjustBounds" | "onShowDesktop">;

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
  onSwitchWindow: () => void;
  children: (app: RunningApp, headerElements: AppWindowHeaderElements) => ReactNode;
};

export function WindowLayer({ apps, activeSegment, desktopSize, focusedAppId, windowed, mobileHeaderActionsElement, restingCamera, trackRef, transitionSegmentKeys, titleForApp, isMaximized, onSwitchWindow, children, ...windowCallbacks }: WindowLayerProps) {
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
            hideFocusedHeader
            externalHeaderElements={focusedAppId === app.id ? { leading: null, actions: mobileHeaderActionsElement } : undefined}
            maximized={isMaximized(app)}
            canMoveArea={windowed}
            onSwitchWindow={onSwitchWindow}
            titleArea={<h2 id={titleId}>{title}</h2>}
          >
            {(headerElements) => children(app, headerElements)}
          </AppWindow>
        </div>;
      })}
    </div>
  </div>;
}
