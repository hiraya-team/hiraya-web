import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, SquaresFour, X } from "@phosphor-icons/react";

export type AppWindowProps = {
  id: string;
  title: string;
  titleId: string;
  zIndex: number;
  focused: boolean;
  minimized: boolean;
  segmentActive: boolean;
  segmentVisible?: boolean;
  onFocus: (id: string) => void;
  onClose?: (id: string) => void;
  onShowDesktop?: () => void;
  onSwitchWindow?: () => void;
  backLabel?: string;
  hideHeader?: boolean;
  externalHeaderElements?: AppWindowHeaderElements;
  children: ReactNode | ((headerElements: AppWindowHeaderElements) => ReactNode);
  titleArea?: ReactNode;
  headerContent?: ReactNode;
};

export type AppWindowHeaderElements = {
  leading: HTMLDivElement | null;
  actions: HTMLDivElement | null;
};

export function AppWindow({
  id,
  title,
  titleId,
  zIndex,
  focused,
  minimized,
  segmentActive,
  segmentVisible = segmentActive,
  onFocus,
  onClose,
  onShowDesktop,
  onSwitchWindow,
  backLabel = "Back to Desktop",
  hideHeader = false,
  externalHeaderElements,
  children,
  titleArea,
  headerContent,
}: AppWindowProps) {
  const [headerLeadingElement, setHeaderLeadingElement] = useState<HTMLDivElement | null>(null);
  const [headerActionsElement, setHeaderActionsElement] = useState<HTMLDivElement | null>(null);
  const style: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", zIndex };
  const headerElements = hideHeader && externalHeaderElements
    ? externalHeaderElements
    : { leading: headerLeadingElement, actions: headerActionsElement };

  useEffect(() => {
    const element = document.getElementById(id);
    if (!focused || minimized || !segmentActive || element?.contains(document.activeElement)) return;
    element?.focus();
  }, [focused, id, minimized, segmentActive]);

  return (
    <section
      id={id}
      className="app-window"
      data-app-window={id}
      data-focused={focused || undefined}
      data-minimized={minimized || undefined}
      data-segment-hidden={!segmentVisible || undefined}
      data-full-surface
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleArea ? undefined : titleId}
      aria-label={titleArea ? title : undefined}
      aria-hidden={minimized || !segmentActive || !focused || undefined}
      inert={!segmentActive || !focused}
      tabIndex={-1}
      style={style}
      onPointerDown={() => { if (!focused) onFocus(id); }}
    >
      {!hideHeader && <header className="app-window__header">
        {typeof children === "function" && <div ref={setHeaderLeadingElement} className="app-window__header-leading" />}
        <div className="app-window__title-area">
          {titleArea ?? <h2 id={titleId} className="app-window__title">{title}</h2>}
        </div>
        {(headerContent || typeof children === "function") && <div ref={setHeaderActionsElement} className="app-window__header-content">{headerContent}</div>}
        <div className="app-window__controls">
          {onShowDesktop && <button className="app-window__control app-window__mobile-action" type="button" onClick={onShowDesktop}><ArrowLeft /> <span>{backLabel}</span></button>}
          {onSwitchWindow && <button className="app-window__control app-window__mobile-action" type="button" onClick={onSwitchWindow}><SquaresFour /> <span>Switch Window</span></button>}
          {onClose && <button className="app-window__control app-window__mobile-action app-window__control--close" type="button" onClick={() => onClose(id)}><X /> <span>Close</span></button>}
        </div>
      </header>}
      <div className="app-window__content">{typeof children === "function" ? children(headerElements) : children}</div>
    </section>
  );
}
