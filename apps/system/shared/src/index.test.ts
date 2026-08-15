import { describe, expect, test } from "bun:test";
import { formatBytes, LatestOperation, setAppLoading } from "./index";

describe("system app helpers", () => {
  test("formats file sizes", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(12 * 1024 * 1024)).toBe("12 MB");
  });

  test("invalidates stale authored operations", () => {
    const operations = new LatestOperation();
    const first = operations.begin();
    const second = operations.begin();
    expect(operations.isLatest(first)).toBe(false);
    expect(operations.isLatest(second)).toBe(true);
    operations.invalidate();
    expect(operations.isLatest(second)).toBe(false);
  });

  test("coordinates the shared loading surface", () => {
    const attributes = new Map<string, string>();
    const title = { textContent: "Starting..." };
    const surface = { setAttribute: (name: string, value: string) => attributes.set(name, value) } as unknown as HTMLElement;
    const content = { inert: false, toggleAttribute: (name: string, force: boolean) => attributes.set(`content:${name}`, String(force)) } as unknown as HTMLElement;
    const loading = { hidden: false, querySelector: () => title } as unknown as HTMLElement;

    setAppLoading(surface, content, loading, "Opening Notes.txt...");
    expect(attributes.get("aria-busy")).toBe("true");
    expect(content.inert).toBe(true);
    expect(loading.hidden).toBe(false);
    expect(title.textContent).toBe("Opening Notes.txt...");

    setAppLoading(surface, content, loading);
    expect(attributes.get("aria-busy")).toBe("false");
    expect(content.inert).toBe(false);
    expect(loading.hidden).toBe(true);
  });
});
