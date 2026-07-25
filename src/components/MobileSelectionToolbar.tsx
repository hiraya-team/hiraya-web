import type { ReactNode } from "react";
import { Check } from "@phosphor-icons/react";

export function MobileSelectionToolbar({ count, selectionMode = false, onDone, children }: {
  count: number;
  selectionMode?: boolean;
  onDone?: () => void;
  children?: ReactNode;
}) {
  const itemLabel = `${count} selected ${count === 1 ? "item" : "items"}`;
  return <div className="mobile-selection-toolbar" role="toolbar" aria-label={selectionMode ? `Selection mode: ${itemLabel}` : `Actions for ${itemLabel}`}>
    {selectionMode
      ? <span className="mobile-selection-toolbar__mode" role="status" aria-live="polite" aria-atomic="true"><span>Selecting</span><strong>{count}</strong></span>
      : <span className="mobile-selection-toolbar__count" aria-hidden="true">{count}</span>}
    {children}
    {selectionMode && onDone && <button className="mobile-selection-toolbar__done" type="button" title="Done selecting" aria-label="Done selecting" onClick={onDone}><Check size={17} weight="bold" /><span>Done</span></button>}
  </div>;
}
