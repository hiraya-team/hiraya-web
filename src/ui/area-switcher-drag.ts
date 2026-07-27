import { areaSwitcherDragCommits } from "./shell";

export type AreaSwitcherDrag = {
  expanded: boolean;
  moved: boolean;
  pointerId: number;
  startX: number;
  travel: number;
};

type AreaSwitcherDragAction =
  | { kind: "pointer"; cancelled: boolean; clientX: number; pointerId: number }
  | { kind: "lost-capture" };

export type AreaSwitcherDragSettlement = {
  clearTransform: boolean;
  nextExpanded: boolean | null;
  removeDraggingAttribute: true;
  suppressClick: boolean;
};

export function settleAreaSwitcherDrag(holder: { current: AreaSwitcherDrag | null }, action: AreaSwitcherDragAction): AreaSwitcherDragSettlement | null {
  const drag = holder.current;
  if (!drag || action.kind === "pointer" && drag.pointerId !== action.pointerId) return null;
  holder.current = null;

  const commits = action.kind === "pointer"
    && !action.cancelled
    && areaSwitcherDragCommits(action.clientX - drag.startX, drag.expanded, drag.travel);
  return {
    clearTransform: !commits,
    nextExpanded: commits ? !drag.expanded : null,
    removeDraggingAttribute: true,
    suppressClick: action.kind === "pointer" && drag.moved,
  };
}
