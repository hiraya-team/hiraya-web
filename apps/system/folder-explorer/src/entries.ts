import type { DirectoryEntry } from "@hiraya/apps-sdk";

export function sortEntries(entries: DirectoryEntry[]): DirectoryEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    return left.metadata.name.localeCompare(right.metadata.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function selectionAfterInteraction(current: readonly string[], handle: string, ordered: readonly string[], options: { toggle?: boolean; range?: boolean; anchor?: string | null } = {}) {
  if (options.range && options.anchor) {
    const start = ordered.indexOf(options.anchor);
    const end = ordered.indexOf(handle);
    if (start >= 0 && end >= 0) return ordered.slice(Math.min(start, end), Math.max(start, end) + 1);
  }
  if (options.toggle) return current.includes(handle) ? current.filter((item) => item !== handle) : [...current, handle];
  return [handle];
}
