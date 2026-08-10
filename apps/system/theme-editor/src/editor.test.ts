import { describe, expect, test } from "bun:test";
import type { ThemeDefinition, ThemeEditorState, ThemeEditorTheme } from "@hiraya-team/apps-sdk";
import { backAction, contrastIssues, contrastRatio, copyDraft, draftChanged, editDraft, mergeThemeState, nextCopyName } from "./editor";

const definition: ThemeDefinition = {
  colors: {
    shell: "#172329", chrome: "#202f34", chromeText: "#f4f6f1", window: "#f2f1eb", windowMuted: "#d8d9d3",
    text: "#192229", textMuted: "#4f5858", accent: "#8a5b00", accentText: "#ffffff", border: "#566166",
    danger: "#8c1d18", dangerSurface: "#fff0ee", desktopText: "#ffffff", selection: "#8a5b00",
  },
  shape: { radius: 12, borderWidth: 1 }, effects: { blur: 10, opacity: 1, shadow: 0.4 },
  treatment: { gradientStrength: 0, gradientAngle: 0, texture: "none", textureStrength: 0, textureScale: 4, pixelated: false },
  typography: { family: "system", scale: 1, weight: 500 }, density: 1, motion: 1, iconSize: 56,
};
const theme: ThemeEditorTheme = { id: "custom", name: "Custom", definition, builtIn: false, hasWallpaper: false };

describe("theme drafts", () => {
  test("copies definitions without sharing nested state and tracks changes", () => {
    const draft = copyDraft(theme);
    draft.definition.colors.shell = "#000000";
    expect(theme.definition.colors.shell).toBe("#172329");
    expect(draftChanged(draft)).toBe(true);
    expect(draftChanged(copyDraft(theme))).toBe(false);
  });

  test("creates bounded unique copy names", () => {
    expect(nextCopyName(["Custom", "Custom copy"], "Custom")).toBe("Custom copy 2");
    expect(nextCopyName([], "x".repeat(60))).toHaveLength(60);
  });

  test("edits custom themes in place and built-ins as new copies", () => {
    expect(editDraft(theme, [], "unused")).toEqual(copyDraft(theme));
    const builtIn = { ...theme, id: "hiraya-dusk", name: "Hiraya Dusk", builtIn: true };
    expect(editDraft(builtIn, [builtIn.name], "new-id")).toMatchObject({ id: "new-id", name: "Hiraya Dusk copy", baseline: null });
  });
});

test("contrast reports the failing semantic role", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBe(21);
  const failing = structuredClone(definition);
  failing.colors.desktopText = failing.colors.shell;
  expect(contrastIssues(failing)).toContain("desktop text / desktop shell");
});

test("remote state replaces the library and preserves the active draft", () => {
  const draft = copyDraft(theme);
  draft.name = "Unsaved";
  const incoming: ThemeEditorState = { selectedThemeId: "built-in", themes: [], canManage: true, restrictionReason: "" };
  const merged = mergeThemeState(incoming, draft);
  expect(merged.state).not.toBe(incoming);
  expect(merged.state.selectedThemeId).toBe("built-in");
  expect(merged.draft).toBe(draft);
  expect(merged.draft?.name).toBe("Unsaved");
});

test("Back cancels drafts before leaving wallpaper or the app", () => {
  expect(backAction(true, true)).toBe("draft");
  expect(backAction(false, true)).toBe("theme");
  expect(backAction(false, false)).toBe("home");
});

test("uses the shared item list for the theme library", async () => {
  const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
  const source = await Bun.file(new URL("./main.ts", import.meta.url)).text();
  expect(html).toContain('<hiraya-item-list id="theme-list" class="theme-list" list-role="listbox" label="Available themes">');
  expect(source).toContain('button.dataset.itemId = theme.id;');
  expect(source).toContain('themeList.addEventListener("hiraya-item-select"');
  expect(source).not.toContain("moveThemeFocus");
});
