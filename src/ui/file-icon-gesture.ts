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

/** Sets the maximum interval between touch taps. */
const DOUBLE_TAP_DELAY_MS = 400;
/** Sets the maximum movement between touch taps. */
const DOUBLE_TAP_DISTANCE = 24;

/** Chooses the selection or open action for a completed touch gesture. */
export function touchReleaseAction(previous: TouchTap | null, tap: TouchTap, state: {
  cancelled: boolean;
  moved: boolean;
  longPressed: boolean;
  releasedOnIcon: boolean;
}) {
  if (state.cancelled || state.moved || state.longPressed || !state.releasedOnIcon) return "none";
  if (previous
    && previous.id === tap.id
    && tap.at - previous.at <= DOUBLE_TAP_DELAY_MS
    && Math.hypot(tap.x - previous.x, tap.y - previous.y) <= DOUBLE_TAP_DISTANCE) return "open";
  return "select";
}

/** Resolves touch release. */
export function resolveTouchRelease(previous: TouchTap | null, tap: TouchTap, state: Parameters<typeof touchReleaseAction>[2]) {
  const action = touchReleaseAction(previous, tap, state);
  return { action, nextTap: action === "select" ? tap : null } as const;
}

/** Chooses the context-menu action for a completed pointer press. */
export function contextMenuPressAction(press: ContextMenuPress | null) {
  if (press?.pointerType !== "touch") return "open";
  if (press.moved || press.longPressed) return "suppress";
  return "open";
}

/** Reports whether a drag should dismiss the mobile action sheet. */
export function dismissesSheetDrag(distance: number, durationMs: number) {
  return distance >= 80 || distance >= 28 && distance / Math.max(1, durationMs) >= 0.5;
}
