import { hirayaEvent, HTMLElementBase } from "./shared";

export type ItemListDirection = "asc" | "desc";

/** Names the custom events emitted by a Hiraya item list. */
export const ITEM_LIST_EVENTS = {
  select: "hiraya-item-select",
  activate: "hiraya-item-activate",
  context: "hiraya-item-context",
  reorder: "hiraya-item-reorder",
} as const;

export type ItemListEventDetail = Readonly<{
  id: string;
  clientX: number;
  clientY: number;
  presentation: "menu" | "sheet";
  toggle: boolean;
  range: boolean;
}>;

export type ItemListReorderDetail = Readonly<{
  id: string;
  fromIndex: number;
  toIndex: number;
}>;

/** Sorts item list. */
export function sortItemList<T>(items: readonly T[], compare: (left: T, right: T) => number, direction: ItemListDirection = "asc"): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return items.map((item, index) => ({ item, index })).toSorted((left, right) => sign * compare(left.item, right.item) || left.index - right.index).map(({ item }) => item);
}

/** Moves item list item. */
export function moveItemListItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item!);
  return next;
}

type Press = {
  id: string;
  item: HTMLElement;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  moved: boolean;
  longPressed: boolean;
  timer?: number;
};

type Reorder = {
  id: string;
  item: HTMLElement;
  handle: HTMLElement;
  pointerId: number;
  fromIndex: number;
  toIndex: number;
  startX: number;
  startY: number;
  pointerType: string;
  moved: boolean;
};

/** Selects items managed by the list. */
const ITEM_SELECTOR = "[data-item-id]";
/** Selects interactive controls nested inside list items. */
const INTERACTIVE_SELECTOR = "button, a[href], input, select, textarea, summary, [contenteditable=true]";

/** Implements the Hiraya item list. */
export class HirayaItemList extends HTMLElementBase {
  static readonly observedAttributes = ["label", "list-role", "orientation"];

  #press: Press | null = null;
  #reorder: Reorder | null = null;
  #pointerOwner: string | null = null;
  #doubleClickOwner: string | null = null;
  #lastTap: { id: string; x: number; y: number; at: number } | null = null;
  #suppressClickUntil = 0;
  #openedContext: { id: string; until: number } | null = null;

  /** Creates a hiraya item list instance. */
  constructor() {
    super();
    this.addEventListener("click", this.#onClick);
    this.addEventListener("dblclick", this.#onDoubleClick);
    this.addEventListener("contextmenu", this.#onContextMenu);
    this.addEventListener("keydown", this.#onKeyDown);
    this.addEventListener("pointerdown", this.#onPointerDown);
    this.addEventListener("pointermove", this.#onPointerMove);
    this.addEventListener("pointerup", this.#onPointerUp);
    this.addEventListener("pointercancel", this.#onPointerCancel);
    this.addEventListener("lostpointercapture", this.#onLostPointerCapture);
  }

  /** Initializes the element when it joins the document. */
  connectedCallback(): void { this.#sync(); }
  /** Releases listeners when the element leaves the document. */
  disconnectedCallback(): void { this.#finishPress(true); this.#finishReorder(true); this.#pointerOwner = null; this.#doubleClickOwner = null; }
  /** Synchronizes state after an observed attribute changes. */
  attributeChangedCallback(): void { this.#sync(); }

  /** Synchronizes the rendered state with current properties. */
  #sync(): void {
    const role = this.getAttribute("list-role") ?? "list";
    this.setAttribute("role", role);
    const label = this.getAttribute("label");
    if (label && role !== "none" && role !== "presentation") this.setAttribute("aria-label", label);
    else this.removeAttribute("aria-label");
    const orientation = this.getAttribute("orientation");
    if (orientation && role !== "none" && role !== "presentation") this.setAttribute("aria-orientation", orientation);
    else this.removeAttribute("aria-orientation");
  }

  /** Returns the current item elements. */
  #items(): HTMLElement[] {
    return Array.from(this.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter((item) => item.closest("hiraya-item-list") === this && item.dataset.itemDisabled !== "true");
  }

  /** Returns the item for an event target. */
  #item(target: EventTarget | null): HTMLElement | null {
    const item = target instanceof Element ? target.closest<HTMLElement>(ITEM_SELECTOR) : null;
    return item?.closest("hiraya-item-list") === this ? item : null;
  }

  /** Reports whether an event target is a control nested inside an item. */
  #isNestedControl(target: EventTarget | null, item: HTMLElement): boolean {
    const control = target instanceof Element ? target.closest<HTMLElement>(INTERACTIVE_SELECTOR) : null;
    return Boolean(control && control !== item);
  }

  /** Emits an event to the connected client. */
  #emit(name: string, item: HTMLElement, clientX = 0, clientY = 0, presentation: "menu" | "sheet" = "menu", source?: MouseEvent | KeyboardEvent | PointerEvent): void {
    hirayaEvent<ItemListEventDetail>(this, name, { id: item.dataset.itemId!, clientX, clientY, presentation, toggle: Boolean(source?.metaKey || source?.ctrlKey), range: Boolean(source?.shiftKey) });
  }

  #onClick = (event: MouseEvent): void => {
    const item = this.#item(event.target);
    this.#doubleClickOwner = event.detail === 2 && item?.dataset.itemId === this.#pointerOwner ? this.#pointerOwner : null;
    this.#pointerOwner = null;
    if (performance.now() < this.#suppressClickUntil) {
      event.preventDefault();
      return;
    }
    if (!item || this.#isNestedControl(event.target, item) || !item.hasAttribute("data-item-select")) return;
    this.#emit(ITEM_LIST_EVENTS.select, item, event.clientX, event.clientY, "menu", event);
  };

  #onDoubleClick = (event: MouseEvent): void => {
    const item = this.#item(event.target);
    const owner = this.#doubleClickOwner;
    this.#doubleClickOwner = null;
    if (!item || item.dataset.itemId !== owner || this.#isNestedControl(event.target, item) || !item.hasAttribute("data-item-activate")) return;
    this.#emit(ITEM_LIST_EVENTS.activate, item, event.clientX, event.clientY, "menu", event);
  };

  #onContextMenu = (event: MouseEvent): void => {
    const item = this.#item(event.target);
    if (!item || this.#isNestedControl(event.target, item) || !item.hasAttribute("data-item-context")) return;
    event.preventDefault();
    if (this.#press?.item === item) {
      if (this.#press.timer) window.clearTimeout(this.#press.timer);
      this.#press.timer = undefined;
      this.#press.longPressed = true;
      this.#lastTap = null;
    }
    const openedContext = this.#openedContext;
    if (openedContext && openedContext.id === item.dataset.itemId && performance.now() < openedContext.until) return;
    this.#openedContext = { id: item.dataset.itemId!, until: performance.now() + 700 };
    const pointerType = "pointerType" in event ? String(event.pointerType) : "mouse";
    this.#emit(ITEM_LIST_EVENTS.context, item, event.clientX, event.clientY, pointerType === "touch" ? "sheet" : "menu", event);
  };

  #onKeyDown = (event: KeyboardEvent): void => {
    const item = this.#item(event.target);
    if (!item) return;
    const items = this.#items();
    const index = items.indexOf(item);
    const handle = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-item-reorder-handle]") : null;
    const vertical = this.getAttribute("orientation") !== "horizontal";
    const previousKey = vertical ? "ArrowUp" : "ArrowLeft";
    const nextKey = vertical ? "ArrowDown" : "ArrowRight";

    if (handle && (event.key === previousKey || event.key === nextKey)) {
      event.preventDefault();
      const toIndex = Math.max(0, Math.min(items.length - 1, index + (event.key === previousKey ? -1 : 1)));
      if (toIndex !== index) hirayaEvent<ItemListReorderDetail>(this, ITEM_LIST_EVENTS.reorder, { id: item.dataset.itemId!, fromIndex: index, toIndex });
      return;
    }
    if (this.#isNestedControl(event.target, item)) return;
    if (event.key === "Enter" && item.hasAttribute("data-item-activate") && !this.#isNestedControl(event.target, item)) {
      event.preventDefault();
      this.#emit(ITEM_LIST_EVENTS.activate, item);
      return;
    }
    if ((event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) && item.hasAttribute("data-item-context")) {
      event.preventDefault();
      const bounds = item.getBoundingClientRect();
      this.#emit(ITEM_LIST_EVENTS.context, item, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return;
    }
    const target = event.key === "Home" ? items[0] : event.key === "End" ? items.at(-1) : event.key === previousKey ? items[index - 1] : event.key === nextKey ? items[index + 1] : null;
    if (target) {
      event.preventDefault();
      target.focus();
    }
  };

  #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const item = this.#item(event.target);
    if (!item) return;
    this.#pointerOwner = event.pointerType === "touch" ? null : item.dataset.itemId!;
    this.#doubleClickOwner = null;
    const handle = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-item-reorder-handle]") : null;
    if (handle) {
      const fromIndex = this.#items().indexOf(item);
      if (fromIndex < 0) return;
      handle.setPointerCapture(event.pointerId);
      item.dataset.itemDragging = "true";
      this.#reorder = { id: item.dataset.itemId!, item, handle, pointerId: event.pointerId, fromIndex, toIndex: fromIndex, startX: event.clientX, startY: event.clientY, pointerType: event.pointerType, moved: false };
      return;
    }
    if (this.#isNestedControl(event.target, item)) return;
    const press: Press = { id: item.dataset.itemId!, item, pointerId: event.pointerId, pointerType: event.pointerType, startX: event.clientX, startY: event.clientY, moved: false, longPressed: false };
    if (event.pointerType === "touch" && item.hasAttribute("data-item-context")) press.timer = window.setTimeout(() => {
      if (this.#press !== press || press.moved) return;
      press.timer = undefined;
      press.longPressed = true;
      this.#lastTap = null;
      this.#suppressClickUntil = performance.now() + 700;
      this.#openedContext = { id: item.dataset.itemId!, until: performance.now() + 700 };
      this.#emit(ITEM_LIST_EVENTS.context, item, event.clientX, event.clientY, "sheet");
    }, 500);
    this.#press = press;
  };

  #onPointerMove = (event: PointerEvent): void => {
    const reorder = this.#reorder;
    if (reorder?.pointerId === event.pointerId) {
      const x = event.clientX - reorder.startX;
      const y = event.clientY - reorder.startY;
      if (!reorder.moved && Math.hypot(x, y) < (reorder.pointerType === "touch" ? 12 : 4)) return;
      reorder.moved = true;
      const vertical = this.getAttribute("orientation") !== "horizontal";
      const delta = vertical ? y : x;
      reorder.item.style.transform = vertical ? `translate3d(0, ${delta}px, 0)` : `translate3d(${delta}px, 0, 0)`;
      const point = vertical ? event.clientY : event.clientX;
      const items = this.#items();
      const remaining = items.filter((item) => item !== reorder.item);
      let toIndex = remaining.length;
      for (let index = 0; index < remaining.length; index += 1) {
        const bounds = remaining[index]!.getBoundingClientRect();
        const center = vertical ? bounds.top + bounds.height / 2 : bounds.left + bounds.width / 2;
        if (point < center) { toIndex = index; break; }
      }
      reorder.toIndex = toIndex;
      return;
    }
    const press = this.#press;
    if (!press || press.pointerId !== event.pointerId || press.moved) return;
    if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) < 5) return;
    press.moved = true;
    if (press.timer) window.clearTimeout(press.timer);
    press.timer = undefined;
  };

  #onPointerUp = (event: PointerEvent): void => {
    if (this.#reorder?.pointerId === event.pointerId) {
      this.#finishReorder(false);
      return;
    }
    const press = this.#press;
    if (!press || press.pointerId !== event.pointerId) return;
    this.#finishPress(false, event);
  };

  #onPointerCancel = (event: PointerEvent): void => {
    this.#pointerOwner = null;
    this.#doubleClickOwner = null;
    this.#onLostPointerCapture(event);
  };

  #onLostPointerCapture = (event: PointerEvent): void => {
    if (this.#reorder?.pointerId === event.pointerId) this.#finishReorder(true);
    if (this.#press?.pointerId === event.pointerId) this.#finishPress(true);
  };

  /** Finishes press. */
  #finishPress(cancelled: boolean, event?: PointerEvent): void {
    const press = this.#press;
    if (!press) return;
    this.#press = null;
    if (press.timer) window.clearTimeout(press.timer);
    if (press.moved) this.#suppressClickUntil = performance.now() + 100;
    if (cancelled || press.moved || press.longPressed || !event || press.pointerType !== "touch") return;
    this.#suppressClickUntil = performance.now() + 700;
    const tap = { id: press.id, x: event.clientX, y: event.clientY, at: performance.now() };
    const doubleTap = this.#lastTap?.id === tap.id && tap.at - this.#lastTap.at <= 400 && Math.hypot(tap.x - this.#lastTap.x, tap.y - this.#lastTap.y) <= 24;
    this.#lastTap = doubleTap ? null : tap;
    if (doubleTap && press.item.hasAttribute("data-item-activate")) this.#emit(ITEM_LIST_EVENTS.activate, press.item, event.clientX, event.clientY, "sheet");
    else if (press.item.hasAttribute("data-item-select")) this.#emit(ITEM_LIST_EVENTS.select, press.item, event.clientX, event.clientY, "sheet");
  }

  /** Finishes reorder. */
  #finishReorder(cancelled: boolean): void {
    const reorder = this.#reorder;
    if (!reorder) return;
    this.#reorder = null;
    if (reorder.handle.hasPointerCapture(reorder.pointerId)) reorder.handle.releasePointerCapture(reorder.pointerId);
    reorder.item.style.removeProperty("transform");
    delete reorder.item.dataset.itemDragging;
    if (!cancelled && reorder.moved && reorder.toIndex !== reorder.fromIndex) hirayaEvent<ItemListReorderDetail>(this, ITEM_LIST_EVENTS.reorder, { id: reorder.id, fromIndex: reorder.fromIndex, toIndex: reorder.toIndex });
  }
}
