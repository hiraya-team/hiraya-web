import type { ReactNode } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";

export function MobileSelectionToolbar({ count, contentKey, collapsed, apps, selectionMode = false, onBeginSelectionMode, onToggle, children }: {
  count: number;
  contentKey: string;
  collapsed: boolean;
  apps?: ReactNode;
  selectionMode?: boolean;
  onBeginSelectionMode?: () => void;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const itemLabel = `${count} selected ${count === 1 ? "item" : "items"}`;
  const label = count === 0 ? "File actions" : selectionMode ? `Selection mode: ${itemLabel}` : `Actions for ${itemLabel}`;
  return <div className="mobile-selection-toolbar" data-collapsed={collapsed || undefined}>
    {apps && <div id="installed-app-pins" className="mobile-selection-toolbar__apps" role="toolbar" aria-label="Installed apps" hidden={collapsed}>{apps}</div>}
    <div id="file-action-pins" className="mobile-selection-toolbar__actions" role="toolbar" aria-label={label} hidden={collapsed}>
      <div className="mobile-selection-toolbar__content" key={contentKey}>
        {count > 0 && (selectionMode
          ? <span className="mobile-selection-toolbar__mode" role="status" aria-live="polite" aria-atomic="true"><span>Selecting</span><strong>{count}</strong></span>
          : <button className="mobile-selection-toolbar__count" type="button" title="Select multiple items" aria-label={`Select multiple items; ${itemLabel}`} onClick={onBeginSelectionMode}><span>{count}</span></button>)}
        {children}
      </div>
    </div>
    <button className="mobile-selection-toolbar__toggle" type="button" aria-controls={apps ? "installed-app-pins file-action-pins" : "file-action-pins"} aria-expanded={!collapsed} aria-label={collapsed ? "Show actions and apps" : "Hide actions and apps"} title={collapsed ? "Show actions and apps" : "Hide actions and apps"} onClick={onToggle}>
      {collapsed ? <CaretUp size={20} weight="bold" /> : <CaretDown size={20} weight="bold" />}
    </button>
  </div>;
}
