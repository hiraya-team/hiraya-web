export type TouchTap = {
  id: string;
  x: number;
  y: number;
  at: number;
};

export type ContextMenuPress = {
  pointerType: string;
  moved: boolean;
  longPressed: boolean;
};

const DOUBLE_TAP_DELAY_MS = 400;
const DOUBLE_TAP_DISTANCE = 24;
const SYNTHETIC_DOUBLE_CLICK_DELAY_MS = 700;
let lastTouchReleaseAt = Number.NEGATIVE_INFINITY;

export function recordTouchRelease(at: number) {
  lastTouchReleaseAt = at;
}

export function allowsMouseDoubleClick(at: number) {
  return at - lastTouchReleaseAt > SYNTHETIC_DOUBLE_CLICK_DELAY_MS;
}

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

export function resolveTouchRelease(previous: TouchTap | null, tap: TouchTap, state: Parameters<typeof touchReleaseAction>[2]) {
  recordTouchRelease(tap.at);
  const action = touchReleaseAction(previous, tap, state);
  return { action, nextTap: action === "select" ? tap : null } as const;
}

export function contextMenuPressAction(press: ContextMenuPress | null) {
  if (press?.pointerType !== "touch") return "open";
  if (press.moved || press.longPressed) return "suppress";
  return "select";
}

export function dismissesSheetDrag(distance: number, durationMs: number) {
  return distance >= 80 || distance >= 28 && distance / Math.max(1, durationMs) >= 0.5;
}
