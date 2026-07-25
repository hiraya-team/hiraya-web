const ACTION_SHEET_HISTORY_KEY = "hirayaActionSheet";

export function actionSheetHistoryState(state: unknown, token: string) {
  return {
    ...(state && typeof state === "object" ? state : {}),
    [ACTION_SHEET_HISTORY_KEY]: token,
  };
}

export function actionSheetHistoryToken(state: unknown) {
  if (!state || typeof state !== "object") return null;
  const token = (state as Record<string, unknown>)[ACTION_SHEET_HISTORY_KEY];
  return typeof token === "string" ? token : null;
}
