import { describe, expect, test } from "bun:test";
import { moveItemListItem, sortItemList } from "./item-list";

describe("item list ordering", () => {
  const items = [
    { id: "second-a", name: "Second" },
    { id: "first", name: "First" },
    { id: "second-b", name: "Second" },
  ];

  test("sorts stably in either direction", () => {
    const compare = (left: (typeof items)[number], right: (typeof items)[number]) => left.name.localeCompare(right.name);
    expect(sortItemList(items, compare).map(({ id }) => id)).toEqual(["first", "second-a", "second-b"]);
    expect(sortItemList(items, compare, "desc").map(({ id }) => id)).toEqual(["second-a", "second-b", "first"]);
    expect(items.map(({ id }) => id)).toEqual(["second-a", "first", "second-b"]);
  });

  test("moves one item without mutating the input", () => {
    expect(moveItemListItem(items, 0, 2).map(({ id }) => id)).toEqual(["first", "second-b", "second-a"]);
    expect(moveItemListItem(items, -1, 2)).toEqual(items);
    expect(items[0]?.id).toBe("second-a");
  });
});
