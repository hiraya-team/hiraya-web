/** Keys action-sheet state stored in browser history. */
const ACTION_SHEET_HISTORY_KEY = "hirayaActionSheet";

/** Reads action-sheet navigation state from browser history. */
export function actionSheetHistoryState(state: unknown, token: string) {
  return {
    ...(state && typeof state === "object" ? state : {}),
    [ACTION_SHEET_HISTORY_KEY]: token,
  };
}

/** Returns the action-sheet token stored in browser history. */
export function actionSheetHistoryToken(state: unknown) {
  if (!state || typeof state !== "object") return null;
  const token = (state as Record<string, unknown>)[ACTION_SHEET_HISTORY_KEY];
  return typeof token === "string" ? token : null;
}
