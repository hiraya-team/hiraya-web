import type { ReactNode } from "react";

export function MobileSelectionToolbar({ count, selectionMode = false, children }: {
  count: number;
  selectionMode?: boolean;
  children?: ReactNode;
}) {
  const itemLabel = `${count} selected ${count === 1 ? "item" : "items"}`;
  return <div className="mobile-selection-toolbar" role="toolbar" aria-label={selectionMode ? `Selection mode: ${itemLabel}` : `Actions for ${itemLabel}`}>
    {selectionMode
      ? <span className="mobile-selection-toolbar__mode" role="status" aria-live="polite" aria-atomic="true"><span>Selecting</span><strong>{count}</strong></span>
      : <span className="mobile-selection-toolbar__count" aria-hidden="true">{count}</span>}
    {children}
  </div>;
}
