export type LinearNavigationKey = "ArrowDown" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "End" | "Home";

/** Calculates the next index for linear keyboard navigation. */
export function linearNavigationIndex(current: number, count: number, key: LinearNavigationKey, orientation: "horizontal" | "vertical" | "both" = "both") {
  if (count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const previous = key === "ArrowLeft" || key === "ArrowUp";
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  if (orientation === "horizontal" && !horizontal || orientation === "vertical" && horizontal) return current;
  return (Math.max(0, current) + (previous ? -1 : 1) + count) % count;
}

/** Reports whether a key performs linear navigation. */
export function isLinearNavigationKey(key: string): key is LinearNavigationKey {
  return ["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home"].includes(key);
}

/** Returns enabled, visible menu items from a menu container. */
export function visibleMenuItems(container: ParentNode) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)"))
    .filter((item) => !item.closest("[hidden]") && item.getAttribute("aria-hidden") !== "true");
}

/** Maps a directional key to submenu open or close intent. */
export function submenuKeyIntent(key: string, location: "trigger" | "submenu") {
  if (location === "trigger" && ["ArrowRight", "Enter", " "].includes(key)) return "open" as const;
  if (location === "submenu" && ["ArrowLeft", "Escape"].includes(key)) return "close" as const;
  return "none" as const;
}
