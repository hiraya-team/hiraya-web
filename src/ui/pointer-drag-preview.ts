export type PointerDragPreview = {
  element: HTMLElement;
  root: HTMLElement;
  offsetX: number;
  offsetY: number;
};

/** Creates a drag preview at the current pointer position. */
export function createPointerDragPreview(source: HTMLElement, clientX: number, clientY: number): PointerDragPreview | null {
  const root = source.closest<HTMLElement>(".desktop");
  if (!root) return null;
  const bounds = source.getBoundingClientRect();
  const element = source.cloneNode(true) as HTMLElement;
  const width = source.matches(".folder-explorer__row") ? Math.min(bounds.width, 320) : bounds.width;
  element.classList.add("entry-drag-preview");
  element.removeAttribute("data-dragging");
  element.removeAttribute("data-entry-drop-parent");
  element.removeAttribute("data-folder-target");
  element.removeAttribute("data-selected");
  element.removeAttribute("data-entry-id");
  element.removeAttribute("aria-pressed");
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("inert", "");
  element.style.removeProperty("transform");
  element.style.width = `${width}px`;
  root.append(element);
  const preview = {
    element,
    root,
    offsetX: Math.min(Math.max(clientX - bounds.left, 12), width - 12),
    offsetY: Math.min(Math.max(clientY - bounds.top, 12), bounds.height - 12),
  };
  movePointerDragPreview(preview, clientX, clientY);
  return preview;
}

/** Moves a drag preview to the latest pointer coordinates. */
export function movePointerDragPreview(preview: PointerDragPreview, clientX: number, clientY: number) {
  const bounds = preview.root.getBoundingClientRect();
  preview.element.style.transform = `translate3d(${clientX - bounds.left - preview.offsetX}px, ${clientY - bounds.top - preview.offsetY}px, 0)`;
}

/** Removes pointer drag preview. */
export function removePointerDragPreview(preview?: PointerDragPreview | null) {
  preview?.element.remove();
}
