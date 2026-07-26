import type { ReactNode, Ref } from "react";
import { builtinAppWindow } from "../../apps/registry";
import { AppWindow, type AppWindowHeaderElements, type AppWindowProps } from "../../components/AppWindow";
import { projectLogicalPosition, segmentKey, type SurfaceSegment } from "../../ui/desktop-geometry";
import { areaWorldOrigin } from "../../ui/area-camera";
import type { RunningApp } from "./model";

type DesktopSize = { width: number; height: number };
type WindowCallbacks = Pick<AppWindowProps, "onFocus" | "onBoundsChange" | "onDragAtEdge" | "onDragEnd" | "onMinimize" | "onClose" | "onToggleMaximize" | "onMoveArea" | "onShowDesktop">;

type WindowLayerProps = WindowCallbacks & {
  apps: readonly RunningApp[];
  activeSegment: SurfaceSegment;
  desktopSize: DesktopSize;
  focusedAppId: string | null;
  isMobile: boolean;
  mobileHeaderActionsElement: HTMLDivElement | null;
  restingCamera: { x: number; y: number };
  trackRef: Ref<HTMLDivElement>;
  transitionSegmentKeys: ReadonlySet<string>;
  titleForApp: (app: RunningApp) => string;
  isMaximized: (app: RunningApp) => boolean;
  onSwitchWindow: () => void;
  children: (app: RunningApp, headerElements: AppWindowHeaderElements) => ReactNode;
};

export function WindowLayer({
  apps,
  activeSegment,
  desktopSize,
  focusedAppId,
  isMobile,
  mobileHeaderActionsElement,
  restingCamera,
  trackRef,
  transitionSegmentKeys,
  titleForApp,
  isMaximized,
  onSwitchWindow,
  children,
  ...windowCallbacks
}: WindowLayerProps) {
  return (
    <div className="desktop-area-stage desktop-area-stage--windows">
      <div
        className={`app-window-layer${isMobile ? "" : " desktop-area-track"}`}
        ref={trackRef}
        role="region"
        aria-label="Open windows"
        style={isMobile ? undefined : {
          width: desktopSize.width,
          height: desktopSize.height,
          transform: `translate3d(var(--area-track-x, ${restingCamera.x}px), var(--area-track-y, ${restingCamera.y}px), 0)`,
        }}
      >
        {apps.map((app, index) => {
          const projection = projectLogicalPosition(app.bounds, desktopSize);
          const segmentActive = projection.segment.column === activeSegment.column && projection.segment.row === activeSegment.row;
          const segmentVisible = segmentActive || transitionSegmentKeys.has(segmentKey(projection.segment));
          const localBounds = isMobile
            ? { x: 0, y: 0, width: desktopSize.width, height: desktopSize.height }
            : { ...app.bounds, ...projection.local };
          const origin = areaWorldOrigin(projection.segment, desktopSize);
          const titleId = `running-app-title-${index}`;
          const title = titleForApp(app);
          const appWindow = app.kind === "sandbox"
            ? (app.package.manifest.window ?? { minWidth: 360, minHeight: 260 })
            : builtinAppWindow(app.kind);

          return (
            <div className="desktop-window-segment" key={app.id} style={isMobile ? undefined : { left: origin.x, top: origin.y, width: desktopSize.width, height: desktopSize.height }}>
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
                segmentVisible={isMobile ? segmentActive : segmentVisible}
                mobile={isMobile}
                hideMobileHeader
                externalHeaderElements={isMobile && focusedAppId === app.id ? { leading: null, actions: mobileHeaderActionsElement } : undefined}
                maximized={isMaximized(app)}
                canMoveArea={!isMobile}
                onSwitchWindow={onSwitchWindow}
                titleArea={<h2 id={titleId}>{title}</h2>}
              >
                {(headerElements) => children(app, headerElements)}
              </AppWindow>
            </div>
          );
        })}
      </div>
    </div>
  );
}
