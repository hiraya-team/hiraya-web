import type { DesktopIdentity } from "../types";
import type { DesktopPreference } from "../domain/preferences";
export type { DesktopPreference } from "../domain/preferences";

export function desktopPreferences(desktops: readonly DesktopIdentity[]): DesktopPreference[] {
  return desktops.map(({ id, pinned }) => ({ id, pinned }));
}

export function arrangeDesktops(desktops: readonly DesktopIdentity[], preferences: readonly DesktopPreference[] = []) {
  const byId = new Map(desktops.map((desktop) => [desktop.id, desktop]));
  const arranged = preferences.flatMap(({ id, pinned }) => {
    const desktop = byId.get(id);
    if (!desktop) return [];
    byId.delete(id);
    return [{ ...desktop, pinned }];
  });
  arranged.push(...byId.values());
  return [...arranged.filter((desktop) => desktop.pinned), ...arranged.filter((desktop) => !desktop.pinned)];
}

export function moveDesktopPreference(preferences: readonly DesktopPreference[], id: string, direction: -1 | 1) {
  const index = preferences.findIndex((desktop) => desktop.id === id);
  if (index < 0) return [...preferences];
  const target = index + direction;
  if (target < 0 || target >= preferences.length || preferences[target].pinned !== preferences[index].pinned) return [...preferences];
  const next = [...preferences];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function pinDesktopPreference(preferences: readonly DesktopPreference[], id: string, pinned: boolean) {
  const current = preferences.find((desktop) => desktop.id === id);
  if (!current || current.pinned === pinned) return [...preferences];
  const remaining = preferences.filter((desktop) => desktop.id !== id);
  const insertion = pinned ? remaining.findIndex((desktop) => !desktop.pinned) : remaining.length;
  remaining.splice(insertion < 0 ? remaining.length : insertion, 0, { id, pinned });
  return remaining;
}
