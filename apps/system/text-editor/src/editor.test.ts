import { describe, expect, test } from "bun:test";
import { DEFAULT_TEXT_EDITOR_SETTINGS, formatText, parseTextEditorSettings, TextDocumentState } from "./editor";

describe("Text Editor document behavior", () => {
  test("reloads a clean document after a remote change", () => {
    const state = new TextDocumentState();
    state.load("one", 1);
    expect(state.remote("two", 2)).toBe(true);
    expect(state).toMatchObject({ text: "two", persistedText: "two", revision: 2, remoteConflict: false });
  });

  test("preserves dirty text and records a remote conflict", () => {
    const state = new TextDocumentState();
    state.load("one", 1);
    state.edit("local draft");
    expect(state.remote("remote", 2)).toBe(false);
    expect(state).toMatchObject({ text: "local draft", persistedText: "one", revision: 1, remoteConflict: true });
  });

  test("tracks autosave eligibility and clears conflict after a revision-safe save", () => {
    const state = new TextDocumentState();
    state.load("one", 1);
    state.edit("two");
    state.remote("remote", 2);
    expect(DEFAULT_TEXT_EDITOR_SETTINGS.autoSave && state.dirty).toBe(true);
    state.saved("two", 3);
    expect(state.dirty).toBe(false);
    expect(state.remoteConflict).toBe(false);
  });

  test("formats JSON and preserves compatible copied settings", () => {
    expect(formatText("data.json", "{\"a\":1}")).toBe('{\n  "a": 1\n}\n');
    expect(formatText("notes.txt", "one  \n two\t")).toBe("one\n two\n");
    expect(parseTextEditorSettings({ autoSave: false, autoFormat: true, fontSize: 18, lineWrap: false })).toEqual({ autoSave: false, autoFormat: true, fontSize: 18, lineWrap: false });
    expect(parseTextEditorSettings({ fontSize: 99 })).toEqual(DEFAULT_TEXT_EDITOR_SETTINGS);
  });
});
