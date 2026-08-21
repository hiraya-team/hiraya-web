import type { EditorSettings, FileCreationTemplate } from "../types";

/** Matches the expected MIME type. */
const MIME_TYPE = /^[!#$%&'*+.^_`|~\w-]+\/[!#$%&'*+.^_`|~\w-]+(?:\s*;\s*[!#$%&'*+.^_`|~\w-]+\s*=\s*(?:[!#$%&'*+.^_`|~\w-]+|"(?:[^"\\]|\\.)*"))*\s*$/;

/** Defines the default file creation templates. */
export const DEFAULT_FILE_CREATION_TEMPLATES: FileCreationTemplate[] = [
  { extension: ".json", mimeType: "application/json", content: "{}" },
  { extension: ".hiraya.todo", mimeType: "application/vnd.hiraya.todo+json", content: '{\n  "schemaVersion": 2,\n  "tasks": []\n}\n' },
  { extension: ".url", mimeType: "application/internet-shortcut", content: "[InternetShortcut]\r\nURL=https://example.com\r\n" },
];

/** Parses and validates file creation templates. */
export function parseFileCreationTemplates(value: unknown): FileCreationTemplate[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error("File creation templates have an unsupported format.");
  const extensions = new Set<string>();
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw new Error("A file creation template has an unsupported format.");
    const { extension: rawExtension, mimeType, content } = candidate as Partial<FileCreationTemplate>;
    const extension = typeof rawExtension === "string" ? rawExtension.toLowerCase() : "";
    if (!/^\.[a-z0-9][a-z0-9._-]{0,63}$/.test(extension) || extensions.has(extension) || typeof mimeType !== "string" || mimeType.length > 255 || mimeType.trim() !== mimeType || [...mimeType].some((character) => { const code = character.codePointAt(0) ?? 0; return code < 32 || code === 127; }) || !MIME_TYPE.test(mimeType) || typeof content !== "string" || new TextEncoder().encode(content).byteLength > 64 * 1024) {
      throw new Error("A file creation template has an unsupported format.");
    }
    extensions.add(extension);
    return { extension, mimeType, content };
  });
}

/** Returns file creation template. */
export function fileCreationTemplate(name: string, templates: readonly FileCreationTemplate[]) {
  const lowerName = name.toLowerCase();
  return [...templates].sort((a, b) => b.extension.length - a.extension.length).find(({ extension }) => lowerName.endsWith(extension));
}

/** Returns text editor launch argument. */
export function textEditorLaunchArgument({ autoSave, autoFormat, fontSize, language, lineWrap }: EditorSettings) {
  return JSON.stringify({ autoSave, autoFormat, fontSize, language, lineWrap });
}
