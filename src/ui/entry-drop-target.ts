export type EntryDropDestination = {
  parentId: string | null;
  desktop: boolean;
};

type EntryDropTarget = EntryDropDestination & {
  element: HTMLElement;
};

/** Finds the eligible entry beneath a pointer coordinate. */
export function entryDropTargetAt(clientX: number, clientY: number, draggedEntryId: string): EntryDropTarget | null {
  const elements = document.elementsFromPoint(clientX, clientY);
  for (const element of elements) {
    let target = element.closest<HTMLElement>("[data-entry-drop-parent]");
    while (target) {
      if (target.dataset.entryId !== draggedEntryId && !target.dataset.selected) {
        return { parentId: target.dataset.entryDropParent || null, desktop: false, element: target };
      }
      target = target.parentElement?.closest<HTMLElement>("[data-entry-drop-parent]") ?? null;
    }
  }

  const top = elements[0];
  const desktop = !top?.closest(".app-window") ? top?.closest<HTMLElement>(".desktop") : null;
  return desktop ? { parentId: null, desktop: true, element: desktop } : null;
}

/** Updates the visual entry target beneath a drag preview. */
export function highlightEntryDropTarget(target: HTMLElement | null) {
  document.querySelectorAll<HTMLElement>("[data-internal-drop-target]").forEach((element) => delete element.dataset.internalDropTarget);
  if (target) target.dataset.internalDropTarget = "true";
}
