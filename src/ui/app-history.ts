export type AppHistorySettingsPage = "main" | "themes" | "activity" | "apps" | "short-links";

type AppHistoryState = {
  hiraya?: unknown;
  instances?: unknown;
  settingsPage?: unknown;
};

function historyRecord(state: unknown): AppHistoryState | null {
  return state && typeof state === "object" && (state as AppHistoryState).hiraya === true ? (state as AppHistoryState) : null;
}

export function historyInstanceIds(state: unknown, fallback: readonly string[] = []) {
  const instances = historyRecord(state)?.instances;
  if (!Array.isArray(instances) || instances.length > 100 || instances.some((id) => typeof id !== "string" || !id)) return [...fallback];
  return [...new Set(instances)];
}

export function historySettingsPage(state: unknown): AppHistorySettingsPage {
  const page = historyRecord(state)?.settingsPage;
  return page === "themes" || page === "activity" || page === "apps" || page === "short-links" ? page : "main";
}

export function removedHistoryInstanceIds(current: readonly string[], destination: readonly string[]) {
  const retained = new Set(destination);
  return current.filter((id) => !retained.has(id));
}
