import type { DirectoryEntry } from "@hiraya/apps-sdk";

export function sortEntries(entries: DirectoryEntry[]): DirectoryEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    return left.metadata.name.localeCompare(right.metadata.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function selectionAfterInteraction(current: readonly string[], handle: string, ordered: readonly string[], options: { toggle?: boolean; range?: boolean; additive?: boolean; anchor?: string | null } = {}) {
  if (options.range && options.anchor) {
    const start = ordered.indexOf(options.anchor);
    const end = ordered.indexOf(handle);
    if (start >= 0 && end >= 0) return ordered.slice(Math.min(start, end), Math.max(start, end) + 1);
  }
  if (options.toggle) return current.includes(handle) ? current.filter((item) => item !== handle) : [...current, handle];
  if (options.additive) return current.includes(handle) ? [...current] : [...current, handle];
  return [handle];
}

export type EntryTap = { handle: string; x: number; y: number; at: number };

export function entryTapAction(previous: EntryTap | null, next: EntryTap, valid: boolean) {
  if (!valid) return "none" as const;
  if (previous && previous.handle === next.handle && next.at - previous.at <= 400 && Math.hypot(next.x - previous.x, next.y - previous.y) <= 24) return "open" as const;
  return "select" as const;
}
