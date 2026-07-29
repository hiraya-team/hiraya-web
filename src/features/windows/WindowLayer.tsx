import type { ReactNode, Ref } from "react";
import { AppWindow, type AppWindowHeaderElements, type AppWindowProps } from "../../components/AppWindow";
import { projectLogicalPosition, type SurfaceSegment } from "../../ui/desktop-geometry";
import type { RunningApp } from "./model";

type DesktopSize = { width: number; height: number };
type WindowCallbacks = Pick<AppWindowProps, "onFocus" | "onClose" | "onShowDesktop">;

type WindowLayerProps = WindowCallbacks & {
  apps: readonly RunningApp[];
  activeSegment: SurfaceSegment;
  desktopSize: DesktopSize;
  focusedAppId: string | null;
  mobileHeaderActionsElement: HTMLDivElement | null;
  trackRef: Ref<HTMLDivElement>;
  titleForApp: (app: RunningApp) => string;
  onSwitchWindow: () => void;
  children: (app: RunningApp, headerElements: AppWindowHeaderElements) => ReactNode;
};

export function WindowLayer({
  apps,
  activeSegment,
  desktopSize,
  focusedAppId,
  mobileHeaderActionsElement,
  trackRef,
  titleForApp,
  onSwitchWindow,
  children,
  ...windowCallbacks
}: WindowLayerProps) {
  return (
    <div className="desktop-area-stage desktop-area-stage--windows">
      <div
        className="app-window-layer"
        ref={trackRef}
        role="region"
        aria-label="Open windows"
      >
        {apps.map((app, index) => {
          const projection = projectLogicalPosition(app.bounds, desktopSize);
          const segmentActive = projection.segment.column === activeSegment.column && projection.segment.row === activeSegment.row;
          const titleId = `running-app-title-${index}`;
          const title = titleForApp(app);

          return (
            <div className="desktop-window-segment" key={app.id}>
              <AppWindow
                {...windowCallbacks}
                id={app.id}
                title={title}
                titleId={titleId}
                zIndex={app.zIndex}
                focused={focusedAppId === app.id}
                minimized={app.minimized}
                segmentActive={segmentActive}
                segmentVisible={segmentActive}
                hideHeader
                externalHeaderElements={focusedAppId === app.id ? { leading: null, actions: mobileHeaderActionsElement } : undefined}
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
