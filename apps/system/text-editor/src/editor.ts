export type TextEditorSettings = Readonly<{
  autoSave: boolean;
  autoFormat: boolean;
  fontSize: number;
  lineWrap: boolean;
}>;

export type TextEditorLanguage = "plain" | "markdown" | "json" | "javascript" | "typescript" | "jsx" | "tsx" | "css" | "html" | "xml" | "yaml";

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

export const DEFAULT_TEXT_EDITOR_SETTINGS: TextEditorSettings = { autoSave: true, autoFormat: false, fontSize: 13, lineWrap: true };

export function textEditorLanguageFor(name: string, mimeType = ""): TextEditorLanguage {
  const mime = mimeType.split(";", 1)[0].trim().toLowerCase();
  return MIME_LANGUAGES[mime] ?? (mime.endsWith("+json") ? "json" : mime.endsWith("+xml") ? "xml" : EXTENSION_LANGUAGES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "plain");
}

export function writeRestrictionMessage(reason: "available" | "read-only" | "shared-offline" | "temporarily-unavailable", dirty: boolean) {
  if (reason === "available") return dirty ? "Write access restored. Your unsaved draft is ready to save." : "Write access restored. Editing is available.";
  const explanation = reason === "shared-offline" ? "Reconnect to edit this shared desktop." : reason === "read-only" ? "Your access to this desktop is read-only." : "Editing is temporarily unavailable.";
  return dirty ? `Unsaved draft preserved. ${explanation}` : explanation;
}

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

export function formatText(name: string, text: string): string {
  if (name.toLowerCase().endsWith(".json")) return `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  return `${text.split(/\r?\n/).map((line) => line.trimEnd()).join("\n").trimEnd()}\n`;
}

export function textEditorControlState(initialized: boolean, saving: boolean, canWrite: boolean) {
  return {
    open: initialized && !saving,
    settings: initialized,
    write: initialized && canWrite,
  };
}

export class TextDocumentOperations {
  #foreground = 0;
  #background = 0;
  #foregroundPending = false;

  beginForeground(): number {
    this.#foregroundPending = true;
    this.#background += 1;
    return ++this.#foreground;
  }

  finishForeground(generation: number): void {
    if (generation === this.#foreground) this.#foregroundPending = false;
  }

  isForegroundCurrent(generation: number): boolean { return generation === this.#foreground; }

  beginBackground(): number | null {
    return this.#foregroundPending ? null : ++this.#background;
  }

  isBackgroundCurrent(generation: number): boolean { return generation === this.#background; }

  invalidate(): void {
    this.#foreground += 1;
    this.#background += 1;
    this.#foregroundPending = false;
  }
}

export class TextDocumentState {
  text = "";
  persistedText = "";
  revision: number | null = null;
  remoteConflict = false;

  get dirty() { return this.text !== this.persistedText; }

  load(text: string, revision: number) {
    this.text = text;
    this.persistedText = text;
    this.revision = revision;
    this.remoteConflict = false;
  }

  edit(text: string) { this.text = text; }

  remote(text: string, revision: number) {
    if (revision === this.revision && text === this.persistedText) return true;
    if (this.dirty) { this.remoteConflict = true; return false; }
    this.load(text, revision);
    return true;
  }

  saved(sourceText: string, persistedText: string, revision: number) {
    const unchanged = this.text === sourceText;
    if (unchanged) this.text = persistedText;
    this.persistedText = persistedText;
    this.revision = revision;
    this.remoteConflict = false;
    return unchanged;
  }
}
