export type TouchTap = {
  id: string;
  x: number;
  y: number;
  at: number;
};

const DOUBLE_TAP_DELAY_MS = 400;
const DOUBLE_TAP_DISTANCE = 24;

export function touchReleaseAction(previous: TouchTap | null, tap: TouchTap, state: {
  cancelled: boolean;
  moved: boolean;
  longPressed: boolean;
  releasedOnVisibleContent: boolean;
}) {
  if (state.cancelled || state.moved || state.longPressed || !state.releasedOnVisibleContent) return "none";
  if (previous
    && previous.id === tap.id
    && tap.at - previous.at <= DOUBLE_TAP_DELAY_MS
    && Math.hypot(tap.x - previous.x, tap.y - previous.y) <= DOUBLE_TAP_DISTANCE) return "open";
  return "select";
}

export function dismissesSheetDrag(distance: number, durationMs: number) {
  return distance >= 80 || distance >= 28 && distance / Math.max(1, durationMs) >= 0.5;
}
