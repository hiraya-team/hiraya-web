import { describe, expect, test } from "bun:test";
import { filterAndSortEntries, formatEntrySize, sortActionLabel, sortSummary } from "../src/ui/folder-explorer";
import type { DesktopEntry } from "../src/types";

const entries: DesktopEntry[] = [
  {
    id: "large",
    kind: "file",
    name: "Report 10.pdf",
    parentId: null,
    createdAt: 1,
    modifiedAt: 30,
    position: { x: 0, y: 0 },
    mimeType: "application/pdf",
    size: 2048,
  },
  {
    id: "folder",
    kind: "folder",
    name: "Plans",
    parentId: null,
    createdAt: 1,
    modifiedAt: 20,
    position: { x: 0, y: 0 },
  },
  {
    id: "small",
    kind: "file",
    name: "Report 2.txt",
    parentId: null,
    createdAt: 1,
    modifiedAt: 10,
    position: { x: 0, y: 0 },
    mimeType: "text/plain",
    size: 1,
  },
];

describe("folder explorer entries", () => {
  test("uses the compact sorting toolbar for both mobile views", async () => {
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();
    const mobileRules = css.slice(css.indexOf("@media (max-width: 620px)"), css.indexOf(".trash-window"));

    expect(mobileRules).toContain('.folder-explorer__toolbar[data-view="list"] .folder-explorer__sort');
    expect(mobileRules).toContain('> .folder-explorer__tool-button:not(.folder-explorer__import)');
    expect(mobileRules).toContain(".folder-explorer__columns {\n    display: none;");
  });

  test("filters locally and keeps folders first while sorting", () => {
    expect(filterAndSortEntries(entries, "report", "name", "asc").map((entry) => entry.id)).toEqual(["small", "large"]);
    expect(filterAndSortEntries(entries, "", "date", "desc").map((entry) => entry.id)).toEqual(["folder", "large", "small"]);
    expect(filterAndSortEntries(entries, "", "size", "asc").map((entry) => entry.id)).toEqual(["folder", "small", "large"]);
  });

  test("formats file sizes without assigning sizes to folders", () => {
    expect(formatEntrySize(entries[1])).toBe("");
    expect(formatEntrySize(entries[2])).toBe("1 byte");
    expect(formatEntrySize(entries[0])).toBe("2 KB");
  });

  test("describes sort state and labels controls by their next action", () => {
    expect(sortSummary("name", "asc")).toBe("Sorted by Name, ascending.");
    expect(sortSummary("date", "desc")).toBe("Sorted by Date modified, descending.");
    expect(sortActionLabel("name", "name", "asc")).toBe("Sort by Name, descending");
    expect(sortActionLabel("size", "name", "desc")).toBe("Sort by Size, ascending");
  });
});
