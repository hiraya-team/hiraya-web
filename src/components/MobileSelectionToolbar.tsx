import type { ReactNode } from "react";

/** Renders the mobile selection toolbar interface. */
export function MobileSelectionToolbar({ count, contentKey, selectionMode = false, onBeginSelectionMode, children }: {
  count: number;
  contentKey: string;
  selectionMode?: boolean;
  onBeginSelectionMode?: () => void;
  children?: ReactNode;
}) {
  const itemLabel = `${count} selected ${count === 1 ? "item" : "items"}`;
  const label = count === 0 ? "File actions" : selectionMode ? `Selection mode: ${itemLabel}` : `Actions for ${itemLabel}`;
  return <div className="mobile-selection-toolbar" role="toolbar" aria-label={label}>
    <div className="mobile-selection-toolbar__content" key={contentKey}>
      {count > 0 && (selectionMode
        ? <span className="mobile-selection-toolbar__mode" role="status" aria-live="polite" aria-atomic="true"><span>Selecting</span><strong>{count}</strong></span>
        : <button className="mobile-selection-toolbar__count" type="button" title="Select multiple items" aria-label={`Select multiple items; ${itemLabel}`} onClick={onBeginSelectionMode}><span>{count}</span></button>)}
      {children}
    </div>
  </div>;
}
