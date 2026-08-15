import type { DesktopEntry } from "../types";

export function withoutDotEntries(entries: readonly DesktopEntry[]) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return entries.filter((entry) => {
    const visited = new Set<string>();
    let current: DesktopEntry | undefined = entry;
    while (current && !visited.has(current.id)) {
      if (current.name.startsWith(".")) return false;
      visited.add(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return true;
  });
}
