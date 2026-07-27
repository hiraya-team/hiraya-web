import { describe, expect, test } from "bun:test";
import { DEFAULT_TEXT_EDITOR_SETTINGS, formatText, parseTextEditorSettings, textEditorControlState, TextDocumentOperations, TextDocumentState, writeRestrictionMessage } from "./editor";

describe("Text Editor document behavior", () => {
  test("keeps primary mobile actions at Hiraya's touch target size", async () => {
    const css = await Bun.file(new URL("./style.css", import.meta.url)).text();
    expect(css).toContain("@media (max-width: 700px)");
    expect(css).toContain(":is(#open, #format, #save-as, #save) { min-width: 44px; min-height: 44px; }");
  });

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
    expect(state.saved("two", "two", 3)).toBe(true);
    expect(state.dirty).toBe(false);
    expect(state.remoteConflict).toBe(false);
  });

  test("preserves edits made while a save is pending", () => {
    const state = new TextDocumentState();
    state.load("one", 1);
    state.edit("submitted");
    state.edit("submitted with newer input");

    expect(state.saved("submitted", "submitted", 2)).toBe(false);
    expect(state).toMatchObject({ text: "submitted with newer input", persistedText: "submitted", revision: 2, remoteConflict: false });
    expect(state.dirty).toBe(true);
  });

  test("foreground opens supersede refreshes and block newer background work until finished", () => {
    const operations = new TextDocumentOperations();
    const refresh = operations.beginBackground();
    expect(refresh).not.toBeNull();
    const open = operations.beginForeground();
    expect(operations.isBackgroundCurrent(refresh!)).toBe(false);
    expect(operations.beginBackground()).toBeNull();
    expect(operations.isForegroundCurrent(open)).toBe(true);
    operations.finishForeground(open);
    const nextRefresh = operations.beginBackground();
    expect(nextRefresh).not.toBeNull();
    expect(operations.isBackgroundCurrent(nextRefresh!)).toBe(true);
  });

  test("background refreshes never supersede an active foreground open", () => {
    const operations = new TextDocumentOperations();
    const open = operations.beginForeground();
    expect(operations.beginBackground()).toBeNull();
    expect(operations.isForegroundCurrent(open)).toBe(true);
    operations.finishForeground(open);
  });

  test("enables recovery controls after initialization while capability-gating writes", () => {
    expect(textEditorControlState(false, false, true)).toEqual({ open: false, settings: false, write: false });
    expect(textEditorControlState(true, false, false)).toEqual({ open: true, settings: true, write: false });
    expect(textEditorControlState(true, false, true)).toEqual({ open: true, settings: true, write: true });
    expect(textEditorControlState(true, true, true).open).toBe(false);
  });

  test("applies formatting only when no newer edits arrived during the save", () => {
    const clean = new TextDocumentState();
    clean.load("one", 1);
    clean.edit("two  ");
    expect(clean.saved("two  ", "two\n", 2)).toBe(true);
    expect(clean).toMatchObject({ text: "two\n", persistedText: "two\n", revision: 2 });

    const edited = new TextDocumentState();
    edited.load("one", 1);
    edited.edit("two  ");
    edited.edit("two more");
    expect(edited.saved("two  ", "two\n", 2)).toBe(false);
    expect(edited).toMatchObject({ text: "two more", persistedText: "two\n", revision: 2 });
  });

  test("ignores a duplicate notification for the saved base of a newer draft", () => {
    const state = new TextDocumentState();
    state.load("one", 1);
    state.edit("submitted");
    state.edit("newer draft");
    state.saved("submitted", "submitted", 2);

    expect(state.remote("submitted", 2)).toBe(true);
    expect(state).toMatchObject({ text: "newer draft", persistedText: "submitted", revision: 2, remoteConflict: false });
  });

  test("formats JSON and preserves compatible copied settings", () => {
    expect(formatText("data.json", "{\"a\":1}")).toBe('{\n  "a": 1\n}\n');
    expect(formatText("notes.txt", "one  \n two\t")).toBe("one\n two\n");
    expect(parseTextEditorSettings({ autoSave: false, autoFormat: true, fontSize: 18, lineWrap: false })).toEqual({ autoSave: false, autoFormat: true, fontSize: 18, lineWrap: false });
    expect(parseTextEditorSettings({ fontSize: 99 })).toEqual(DEFAULT_TEXT_EDITOR_SETTINGS);
  });

  test("clearly distinguishes preserved drafts from clean read-only documents", () => {
    expect(writeRestrictionMessage("read-only", false)).toContain("read-only");
    expect(writeRestrictionMessage("shared-offline", true)).toBe("Unsaved draft preserved. Reconnect to edit this shared desktop.");
    expect(writeRestrictionMessage("available", true)).toContain("ready to save");
  });
});
