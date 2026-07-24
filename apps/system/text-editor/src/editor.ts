export type TextEditorSettings = Readonly<{
  autoSave: boolean;
  autoFormat: boolean;
  fontSize: number;
  lineWrap: boolean;
}>;

export const DEFAULT_TEXT_EDITOR_SETTINGS: TextEditorSettings = { autoSave: true, autoFormat: false, fontSize: 13, lineWrap: true };

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
    if (this.dirty) { this.remoteConflict = true; return false; }
    this.load(text, revision);
    return true;
  }

  saved(text: string, revision: number) {
    this.text = text;
    this.persistedText = text;
    this.revision = revision;
    this.remoteConflict = false;
  }
}
