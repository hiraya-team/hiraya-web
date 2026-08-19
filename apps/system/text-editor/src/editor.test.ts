import { describe, expect, test } from "bun:test";
import { DEFAULT_TEXT_EDITOR_SETTINGS, formatText, parseTextEditorSettings, textEditorControlState, textEditorLanguageFor, TextDocumentOperations, TextDocumentState, writeRestrictionMessage } from "./editor";

describe("Integrated Editor document behavior", () => {
  test("leads the window title with the active document", async () => {
    const source = await Bun.file(new URL("./main.ts", import.meta.url)).text();
    expect(source).toContain('const title = scene?.metadata?.name ?? (scene ? "Untitled Scene" : activeTab?.name)');
    expect(source).toContain('const titleDirty = scene?.archive.dirty ?? (activeTab ? tabDirty(activeTab) : false)');
    expect(source).toContain('publishWindowTitle(title ? `${titleDirty ? "*" : ""}${title} - Integrated Editor` : "Integrated Editor")');
    expect(source).toContain("await load(launchFile, generation)");
    expect(source).toContain("if (!launchFile) setStatus(");

    const load = source.slice(source.indexOf("async function load("), source.indexOf("async function statFile("));
    expect(load.indexOf("const loaded = kind ===")).toBeGreaterThan(load.indexOf("const entry = await statFile(next)"));
    expect(source).not.toContain(" - Text Editor");
  });

  test("does not replace the current document identity before an interactive file opens", async () => {
    const source = await Bun.file(new URL("./main.ts", import.meta.url)).text();
    expect(source).toContain("await load(selected[0], generation)");
    expect(source).not.toContain("await load(selected[0], generation, true)");
    expect(source).toContain("if (scene?.handle === next) return");
    expect(source).toContain("if (!operations.isForegroundCurrent(generation)) return");
  });

  test("keeps mobile editor controls at Hiraya's touch target size", async () => {
    const css = await Bun.file(new URL("./style.css", import.meta.url)).text();
    expect(css).toContain("@media (max-width: 700px)");
    expect(css).toContain(".workspace-picker, .workspace-heading, .tree-row, .search-box, .search-results button, .editor-tab > button, .breadcrumbs button, .settings-group label, .dialog-actions button");
    expect(css).toContain("min-width: 44px; min-height: 44px;");
  });

  test("keeps editor chrome selectors aligned with its runtime states", async () => {
    const source = await Bun.file(new URL("./main.ts", import.meta.url)).text();
    const css = await Bun.file(new URL("./style.css", import.meta.url)).text();
    expect(css).toContain('button[aria-pressed="true"]');
    expect(css).not.toContain('[role="tab"]');
    expect(source).toContain('status.closest("hiraya-status-bar")?.classList.toggle("error", error)');
    expect(source).toContain('setSidebarOpen(!matchMedia("(max-width: 700px)").matches)');
    expect(source).toContain("selectedPath = row.dataset.scenePath");
    expect(source).toContain('required<HTMLElement>("#scene-conflict").hidden = !scene?.archive.conflict');
  });

  test("uses the shared read-only badge without bespoke pill styles", async () => {
    const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
    const css = await Bun.file(new URL("./style.css", import.meta.url)).text();
    expect(html).toContain('<hiraya-badge tone="readonly" id="write-state" hidden>Read-only</hiraya-badge>');
    expect(css).not.toContain(".write-state");
  });

  test("moves document actions into app commands", async () => {
    const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
    const source = await Bun.file(new URL("./main.ts", import.meta.url)).text();
    expect(html).not.toContain("<hiraya-toolbar");
    expect(source).toContain('{ id: "save-as", title: "Save As"');
    expect(source).toContain('id === "save-as" ? void save(true)');
    expect(source).toContain("const documentCommands = canWrite && savable");
    expect(source).toContain("if (signature === commandSignature) return");
    expect(source).toContain("if (dirty !== windowDirty)");
    expect(source).toContain("if (!saveAs && (scene?.handle && !scene.archive.dirty || activeTab?.handle && !activeTab.state?.dirty)) return;");
    expect(source).toContain("renderWorkspace(); renderDocumentState(); scheduleScenePreview();");
  });

  test("keeps settings in the sidebar and the filename in tabs", async () => {
    const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
    expect(html).toContain('id="settings-view"');
    expect(html).toContain('id="settings-panel" class="sidebar-panel settings-page"');
    expect(html).not.toContain("popover");
    expect(html).not.toContain('id="title"');
    expect(html).toContain('id="breadcrumbs" class="breadcrumbs" aria-label="Current folder path" hidden');
  });

  test("uses the shared item list for workspace search results", async () => {
    const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
    const source = await Bun.file(new URL("./main.ts", import.meta.url)).text();
    const manifest = await Bun.file(new URL("../public/hiraya.app.json", import.meta.url)).json();
    expect(manifest.version).toBe("1.5.6");
    expect(manifest.window).toMatchObject({ renderWidth: 818, renderHeight: 572 });
    expect(html).toContain('<hiraya-item-list id="search-results" class="search-results" list-role="listbox" label="Matching workspace files">');
    expect(source).toContain('button.dataset.itemId = entry.metadata.handle; button.dataset.itemSelect = "";');
    expect(source).toContain('searchResults.addEventListener("hiraya-item-select"');
    expect(source).not.toContain("handleSearchKey");
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

  test("formats supported web languages and preserves compatible copied settings", async () => {
    expect(globalThis).not.toHaveProperty("beautifier");
    expect(await formatText("data.json", "", "{\"a\":1}")).toBe('{\n  "a": 1\n}\n');
    expect(await formatText("index.html", "", "<main><div>Hello</div><div>world</div></main>")).toBe("<main>\n  <div>Hello</div>\n  <div>world</div>\n</main>\n");
    expect(await formatText("style.css", "", "body{color:red;margin:0}")).toBe("body {\n  color: red;\n  margin: 0\n}\n");
    expect(await formatText("app.js", "", "const value={answer:42,items:[1,2]};")).toBe("const value = {\n  answer: 42,\n  items: [1, 2]\n};\n");
    expect(await formatText("notes.txt", "", "one  \n two\t")).toBe("one\n two\n");
    expect(parseTextEditorSettings({ autoSave: false, autoFormat: true, fontSize: 18, lineWrap: false })).toEqual({ autoSave: false, autoFormat: true, fontSize: 18, lineWrap: false });
    expect(parseTextEditorSettings({ fontSize: 99 })).toEqual(DEFAULT_TEXT_EDITOR_SETTINGS);
  });

  test("rejects invalid JSON instead of rewriting it", async () => {
    await expect(formatText("data.json", "", "{")).rejects.toBeDefined();
  });

  test("selects syntax highlighting from the file MIME type or extension", () => {
    expect(textEditorLanguageFor("component.TSX")).toBe("tsx");
    expect(textEditorLanguageFor("site.min.js")).toBe("javascript");
    expect(textEditorLanguageFor("config.yml")).toBe("yaml");
    expect(textEditorLanguageFor("README.md")).toBe("markdown");
    expect(textEditorLanguageFor("settings", "application/json")).toBe("json");
    expect(textEditorLanguageFor("features.hiraya.todo", "application/vnd.hiraya.todo+json")).toBe("json");
    expect(textEditorLanguageFor("README", "text/markdown; charset=utf-8")).toBe("markdown");
    expect(textEditorLanguageFor("feed", "application/atom+xml")).toBe("xml");
    expect(textEditorLanguageFor("config", "application/yaml")).toBe("yaml");
    expect(textEditorLanguageFor("data.txt", "application/json")).toBe("json");
    expect(textEditorLanguageFor("LICENSE")).toBe("plain");
  });

  test("uses one toggle path and expansion state for every sidebar view", async () => {
    const html = await Bun.file(new URL("../index.html", import.meta.url)).text();
    const source = await Bun.file(new URL("./main.ts", import.meta.url)).text();
    for (const view of ["explorer", "search", "settings"]) {
      expect(html).toContain(`id="${view}-view"`);
      expect(html.slice(html.indexOf(`id="${view}-view"`), html.indexOf(`id="${view}-view"`) + 300)).toContain('aria-expanded="');
      expect(source).toContain(`toggleSidebar("${view}")`);
    }
  });

  test("clearly distinguishes preserved drafts from clean read-only documents", () => {
    expect(writeRestrictionMessage("read-only", false)).toContain("read-only");
    expect(writeRestrictionMessage("shared-offline", true)).toBe("Unsaved draft preserved. Reconnect to edit this shared desktop.");
    expect(writeRestrictionMessage("available", true)).toContain("ready to save");
  });
});
