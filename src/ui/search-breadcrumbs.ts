import type { DesktopEntry } from "../types";

/** Indexes entry ancestry as searchable breadcrumb text. */
export function indexSearchBreadcrumbs(entries: readonly DesktopEntry[]) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const breadcrumbs = new Map<string, string[]>();
  const resolving = new Set<string>();

  function resolve(entry: DesktopEntry): string[] {
    const cached = breadcrumbs.get(entry.id);
    if (cached) return cached;
    if (!entry.parentId || resolving.has(entry.id)) {
      breadcrumbs.set(entry.id, []);
      return [];
    }
    resolving.add(entry.id);
    const parent = byId.get(entry.parentId);
    const result = parent?.kind === "folder" ? [...resolve(parent), parent.name] : [];
    resolving.delete(entry.id);
    breadcrumbs.set(entry.id, result);
    return result;
  }

  for (const entry of entries) resolve(entry);
  return breadcrumbs;
}
