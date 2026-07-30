import { describe, expect, test } from "bun:test";
import { compileAppsUiRuntime } from "../build/apps-ui-runtime";

describe("host apps UI runtime", () => {
  test("builds a self-contained runtime that registers every public element without network access", async () => {
    const runtime = await compileAppsUiRuntime(new URL("..", import.meta.url).pathname);
    const defined: string[] = [];
    const originalCustomElements = Object.getOwnPropertyDescriptor(globalThis, "customElements");
    Object.defineProperty(globalThis, "customElements", {
      configurable: true,
      value: { get: () => undefined, define: (name: string) => defined.push(name) },
    });

    try {
      Function(runtime.script)();
    } finally {
      if (originalCustomElements) Object.defineProperty(globalThis, "customElements", originalCustomElements);
      else delete (globalThis as { customElements?: unknown }).customElements;
    }

    expect(runtime.abi).toBe(1);
    expect(runtime.styles).toContain(":where(.hiraya-app)");
    expect(defined).toEqual([
      "hiraya-button", "hiraya-badge", "hiraya-toolbar", "hiraya-panel", "hiraya-status-bar", "hiraya-empty-state",
      "hiraya-notice", "hiraya-dialog", "hiraya-confirm-dialog", "hiraya-popover", "hiraya-menu-item", "hiraya-menu",
      "hiraya-submenu", "hiraya-action-sheet", "hiraya-selection-toolbar", "hiraya-image-viewer",
    ]);
    expect(runtime.script).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b/);
    expect(runtime.script).toContain("hiraya-app");
  });
});
