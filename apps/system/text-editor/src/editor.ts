import { css_beautify, html_beautify, js_beautify } from "js-beautify";

export type TextEditorSettings = Readonly<{
  autoSave: boolean;
  autoFormat: boolean;
  fontSize: number;
  lineWrap: boolean;
}>;

export type TextEditorLanguage = "plain" | "markdown" | "json" | "javascript" | "typescript" | "jsx" | "tsx" | "css" | "html" | "xml" | "yaml";

/** Maps file extensions to editor languages. */
const EXTENSION_LANGUAGES: Readonly<Record<string, TextEditorLanguage>> = {
  css: "css",
  htm: "html",
  html: "html",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  markdown: "markdown",
  md: "markdown",
  ts: "typescript",
  tsx: "tsx",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

/** Maps MIME types to editor languages. */
const MIME_LANGUAGES: Readonly<Record<string, TextEditorLanguage>> = {
  "application/ecmascript": "javascript",
  "application/javascript": "javascript",
  "application/json": "json",
  "application/typescript": "typescript",
  "application/xml": "xml",
  "application/x-yaml": "yaml",
  "application/yaml": "yaml",
  "text/css": "css",
  "text/ecmascript": "javascript",
  "text/html": "html",
  "text/javascript": "javascript",
  "text/jsx": "jsx",
  "text/markdown": "markdown",
  "text/typescript": "typescript",
  "text/tsx": "tsx",
  "text/xml": "xml",
  "text/x-yaml": "yaml",
  "text/yaml": "yaml",
};

/** Defines the default text editor settings. */
export const DEFAULT_TEXT_EDITOR_SETTINGS: TextEditorSettings = { autoSave: true, autoFormat: false, fontSize: 13, lineWrap: true };

/** Selects an editor language from a file name and MIME type. */
export function textEditorLanguageFor(name: string, mimeType = ""): TextEditorLanguage {
  const mime = mimeType.split(";", 1)[0].trim().toLowerCase();
  return MIME_LANGUAGES[mime] ?? (mime.endsWith("+json") ? "json" : mime.endsWith("+xml") ? "xml" : EXTENSION_LANGUAGES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "plain");
}

/** Writes restriction message. */
export function writeRestrictionMessage(reason: "available" | "read-only" | "shared-offline" | "temporarily-unavailable", dirty: boolean) {
  if (reason === "available") return dirty ? "Write access restored. Your unsaved draft is ready to save." : "Write access restored. Editing is available.";
  const explanation = reason === "shared-offline" ? "Reconnect to edit this shared desktop." : reason === "read-only" ? "Your access to this desktop is read-only." : "Editing is temporarily unavailable.";
  return dirty ? `Unsaved draft preserved. ${explanation}` : explanation;
}

/** Parses text editor settings. */
export function parseTextEditorSettings(value: unknown, fallback: TextEditorSettings = DEFAULT_TEXT_EDITOR_SETTINGS): TextEditorSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const item = value as Record<string, unknown>;
  return {
    autoSave: typeof item.autoSave === "boolean" ? item.autoSave : fallback.autoSave,
    autoFormat: typeof item.autoFormat === "boolean" ? item.autoFormat : fallback.autoFormat,
    fontSize: Number.isInteger(item.fontSize) && Number(item.fontSize) >= 11 && Number(item.fontSize) <= 22 ? Number(item.fontSize) : fallback.fontSize,
    lineWrap: typeof item.lineWrap === "boolean" ? item.lineWrap : fallback.lineWrap,
  };
}

/** Formats text. */
export async function formatText(name: string, mimeType: string, text: string): Promise<string> {
  const language = textEditorLanguageFor(name, mimeType);
  if (language === "json") return `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  if (language === "html") return `${html_beautify(text, { indent_size: 2 }).trimEnd()}\n`;
  if (language === "css") return `${css_beautify(text, { indent_size: 2 }).trimEnd()}\n`;
  if (language === "javascript" || language === "jsx") return `${js_beautify(text, { indent_size: 2 }).trimEnd()}\n`;
  return `${text.split(/\r?\n/).map((line) => line.trimEnd()).join("\n").trimEnd()}\n`;
}

/** Derives enabled editor controls from the current write state. */
export function textEditorControlState(initialized: boolean, saving: boolean, canWrite: boolean) {
  return {
    open: initialized && !saving,
    settings: initialized,
    write: initialized && canWrite,
  };
}

/** Implements the text document operations. */
export class TextDocumentOperations {
  #foreground = 0;
  #background = 0;
  #foregroundPending = false;

  /** Begins foreground. */
  beginForeground(): number {
    this.#foregroundPending = true;
    this.#background += 1;
    return ++this.#foreground;
  }

  /** Finishes foreground. */
  finishForeground(generation: number): void {
    if (generation === this.#foreground) this.#foregroundPending = false;
  }

  /** Reports whether a foreground operation is current. */
  isForegroundCurrent(generation: number): boolean { return generation === this.#foreground; }

  /** Begins background. */
  beginBackground(): number | null {
    return this.#foregroundPending ? null : ++this.#background;
  }

  /** Reports whether a background operation is current. */
  isBackgroundCurrent(generation: number): boolean { return generation === this.#background; }

  /** Invalidates all pending document operations. */
  invalidate(): void {
    this.#foreground += 1;
    this.#background += 1;
    this.#foregroundPending = false;
  }
}

/** Implements the text document state. */
export class TextDocumentState {
  text = "";
  persistedText = "";
  revision: number | null = null;
  remoteConflict = false;

  /** Reports whether the document contains unsaved edits. */
  get dirty() { return this.text !== this.persistedText; }

  /** Loads persisted document text and revision. */
  load(text: string, revision: number) {
    this.text = text;
    this.persistedText = text;
    this.revision = revision;
    this.remoteConflict = false;
  }

  /** Replaces the current document text. */
  edit(text: string) { this.text = text; }

  /** Applies remote text unless local edits would conflict. */
  remote(text: string, revision: number) {
    if (revision === this.revision && text === this.persistedText) return true;
    if (this.dirty) { this.remoteConflict = true; return false; }
    this.load(text, revision);
    return true;
  }

  /** Records saved text while preserving newer local edits. */
  saved(sourceText: string, persistedText: string, revision: number) {
    const unchanged = this.text === sourceText;
    if (unchanged) this.text = persistedText;
    this.persistedText = persistedText;
    this.revision = revision;
    this.remoteConflict = false;
    return unchanged;
  }
}
