import { SETTINGS_PAGES, type SettingsPage } from "../lib/routes";

type AppHistoryState = {
  hiraya?: unknown;
  instances?: unknown;
  settingsPage?: unknown;
};

/** Reads the current app history record from browser state. */
function historyRecord(state: unknown): AppHistoryState | null {
  return state && typeof state === "object" && (state as AppHistoryState).hiraya === true ? (state as AppHistoryState) : null;
}

/** Returns the app instance IDs recorded in browser history. */
export function historyInstanceIds(state: unknown, fallback: readonly string[] = []) {
  const instances = historyRecord(state)?.instances;
  if (!Array.isArray(instances) || instances.length > 100 || instances.some((id) => typeof id !== "string" || !id)) return [...fallback];
  return [...new Set(instances)];
}

/** Returns the settings page recorded in browser history. */
export function historySettingsPage(state: unknown): SettingsPage {
  const page = historyRecord(state)?.settingsPage;
  if (typeof page === "string" && (SETTINGS_PAGES as readonly string[]).includes(page)) return page as SettingsPage;
  if (page === "desktops") return "desktop/desktops";
  if (page === "activity") return "sync-storage/activity";
  if (page === "apps") return "files-apps/file-types";
  if (page === "short-links") return "sharing/short-links";
  return "desktop";
}

/** Finds app instances removed between history states. */
export function removedHistoryInstanceIds(current: readonly string[], destination: readonly string[]) {
  const retained = new Set(destination);
  return current.filter((id) => !retained.has(id));
}
