export function opensOnTouchRelease(state: {
  cancelled: boolean;
  moved: boolean;
  longPressed: boolean;
  releasedOnVisibleContent: boolean;
}) {
  return !state.cancelled && !state.moved && !state.longPressed && state.releasedOnVisibleContent;
}
