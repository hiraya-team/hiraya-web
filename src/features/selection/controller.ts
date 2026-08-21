import { useCallback, useRef, useState } from "react";

export type SelectionOptions = { toggle?: boolean; range?: boolean; orderedIds?: string[] };

/** Computes the next desktop selection for a pointer or keyboard action. */
export function selectedEntryIds(current: readonly string[], entryId: string, anchorId: string | null, options: SelectionOptions = {}) {
  if (options.range && anchorId && options.orderedIds) {
    const start = options.orderedIds.indexOf(anchorId);
    const end = options.orderedIds.indexOf(entryId);
    if (start >= 0 && end >= 0) return { ids: options.orderedIds.slice(Math.min(start, end), Math.max(start, end) + 1), anchorId };
  }
  if (options.toggle) return { ids: current.includes(entryId) ? current.filter((id) => id !== entryId) : [...current, entryId], anchorId: entryId };
  if (current.includes(entryId)) return null;
  return { ids: [entryId], anchorId: entryId };
}

/** Owns desktop selection state and range-selection behavior. */
export function useDesktopSelection() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdsRef = useRef<string[]>([]);
  const [selectionScope, setSelectionScope] = useState("desktop");
  const selectionScopeRef = useRef("desktop");
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [mobileMultiSelectScope, setMobileMultiSelectScope] = useState<string | null>(null);

  const replaceSelection = useCallback((surface: string, ids: string[], anchorId = ids.at(-1) ?? null) => {
    const unique = [...new Set(ids)];
    selectedIdsRef.current = unique;
    setSelectedIds(unique);
    selectionScopeRef.current = surface;
    setSelectionScope(surface);
    setSelectionAnchorId(anchorId);
    if (!unique.length) setMobileMultiSelectScope((current) => current === surface ? null : current);
  }, []);

  const selectEntry = useCallback((surface: string, entryId: string, options: SelectionOptions = {}) => {
    const current = selectionScope === surface ? selectedIdsRef.current : [];
    const next = selectedEntryIds(current, entryId, selectionScope === surface ? selectionAnchorId : null, options);
    if (next) replaceSelection(surface, next.ids, next.anchorId);
  }, [replaceSelection, selectionAnchorId, selectionScope]);

  const retainSelection = useCallback((retainedIds: ReadonlySet<string>) => {
    const next = selectedIdsRef.current.filter((id) => retainedIds.has(id));
    selectedIdsRef.current = next;
    setSelectedIds(next);
    if (!next.length) setMobileMultiSelectScope((scope) => scope === selectionScopeRef.current ? null : scope);
  }, []);

  const beginMobileMultiSelect = useCallback((surface: string) => setMobileMultiSelectScope(surface), []);

  return {
    selectedIds,
    selectedIdsRef,
    selectionScope,
    selectionScopeRef,
    mobileMultiSelectScope,
    replaceSelection,
    selectEntry,
    retainSelection,
    beginMobileMultiSelect,
  };
}
