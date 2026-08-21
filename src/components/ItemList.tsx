import { createElement, useEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { HirayaItemList, ITEM_LIST_EVENTS, moveItemListItem, sortItemList, type ItemListDirection, type ItemListEventDetail, type ItemListReorderDetail } from "@hiraya/apps-ui/elements";

if (typeof customElements !== "undefined" && !customElements.get("hiraya-item-list")) customElements.define("hiraya-item-list", HirayaItemList);

type ItemAttributes = HTMLAttributes<HTMLElement> & {
  "data-item-id": string;
  "data-item-select"?: string;
  "data-item-activate"?: string;
  "data-item-context"?: string;
  "data-item-disabled"?: string;
};

type ReorderHandleAttributes = HTMLAttributes<HTMLElement> & {
  "data-item-reorder-handle": string;
};

type RenderContext = Readonly<{
  index: number;
  itemProps: ItemAttributes;
  reorderHandleProps: ReorderHandleAttributes;
}>;

type Props<T> = Readonly<{
  items: readonly T[];
  getId: (item: T) => string;
  renderItem: (item: T, context: RenderContext) => ReactNode;
  label: string;
  className?: string;
  role?: "list" | "listbox";
  orientation?: "vertical" | "horizontal";
  layout?: "list" | "grid";
  multiselectable?: boolean;
  leading?: ReactNode;
  sort?: Readonly<{ compare: (left: T, right: T) => number; direction: ItemListDirection }>;
  reorder?: Readonly<{ onChange: (items: T[]) => void; canMove?: (item: T, fromIndex: number, toIndex: number, items: readonly T[]) => boolean }>;
  onSelect?: (item: T, detail: ItemListEventDetail) => void;
  onActivate?: (item: T, detail: ItemListEventDetail) => void;
  onContextMenu?: (item: T, detail: ItemListEventDetail) => void;
}>;

/** Renders the item list interface. */
export function ItemList<T>({ items, getId, renderItem, label, className, role = "list", orientation = "vertical", layout, multiselectable = false, leading, sort, reorder, onSelect, onActivate, onContextMenu }: Props<T>) {
  const ref = useRef<HTMLElement>(null);
  const ordered = sort ? sortItemList(items, sort.compare, sort.direction) : [...items];
  const state = useRef({ ordered, getId, reorder, onSelect, onActivate, onContextMenu });
  state.current = { ordered, getId, reorder, onSelect, onActivate, onContextMenu };

  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    const item = (id: string) => state.current.ordered.find((candidate) => state.current.getId(candidate) === id);
    const select = (event: Event) => {
      const detail = (event as CustomEvent<ItemListEventDetail>).detail;
      const candidate = item(detail.id);
      if (candidate) state.current.onSelect?.(candidate, detail);
    };
    const activate = (event: Event) => {
      const detail = (event as CustomEvent<ItemListEventDetail>).detail;
      const candidate = item(detail.id);
      if (candidate) state.current.onActivate?.(candidate, detail);
    };
    const context = (event: Event) => {
      const detail = (event as CustomEvent<ItemListEventDetail>).detail;
      const candidate = item(detail.id);
      if (candidate) state.current.onContextMenu?.(candidate, detail);
    };
    const reorderItem = (event: Event) => {
      const { ordered: current, reorder: currentReorder } = state.current;
      if (!currentReorder) return;
      const { fromIndex, toIndex } = (event as CustomEvent<ItemListReorderDetail>).detail;
      const candidate = current[fromIndex];
      if (candidate && (currentReorder.canMove?.(candidate, fromIndex, toIndex, current) ?? true)) currentReorder.onChange(moveItemListItem(current, fromIndex, toIndex));
    };
    list.addEventListener(ITEM_LIST_EVENTS.select, select);
    list.addEventListener(ITEM_LIST_EVENTS.activate, activate);
    list.addEventListener(ITEM_LIST_EVENTS.context, context);
    list.addEventListener(ITEM_LIST_EVENTS.reorder, reorderItem);
    return () => {
      list.removeEventListener(ITEM_LIST_EVENTS.select, select);
      list.removeEventListener(ITEM_LIST_EVENTS.activate, activate);
      list.removeEventListener(ITEM_LIST_EVENTS.context, context);
      list.removeEventListener(ITEM_LIST_EVENTS.reorder, reorderItem);
    };
  }, []);

  const renderedItems = ordered.map((item, index) => renderItem(item, {
    index,
    itemProps: {
      "data-item-id": getId(item),
      role: role === "listbox" ? "option" : "listitem",
      "data-item-select": onSelect ? "" : undefined,
      "data-item-activate": onActivate ? "" : undefined,
      "data-item-context": onContextMenu ? "" : undefined,
    },
    reorderHandleProps: { "data-item-reorder-handle": "" },
  }));
  return createElement("hiraya-item-list", { ref, className, "list-role": "none", orientation, "data-view": layout }, leading, createElement("div", { className: "item-list__items", role, "aria-label": label, "aria-orientation": role === "listbox" ? orientation : undefined, "aria-multiselectable": role === "listbox" && multiselectable ? true : undefined }, renderedItems));
}
