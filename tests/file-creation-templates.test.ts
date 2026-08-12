import { describe, expect, test } from "bun:test";
import { DEFAULT_FILE_CREATION_TEMPLATES, fileCreationTemplate, parseFileCreationTemplates } from "../src/lib/file-creation-templates";
import { parseEditorSettings } from "../src/lib/contracts";

describe("file creation templates", () => {
  test("supplies canonical defaults for older desktop settings", () => {
    const settings = parseEditorSettings({ autoSave: true, autoFormat: false, fontSize: 13, language: "auto", lineWrap: true });
    expect(settings.fileCreationTemplates).toEqual(DEFAULT_FILE_CREATION_TEMPLATES);
    expect(settings.fileCreationTemplates.find(({ extension }) => extension === ".json")?.content).toBe("{}");
    expect(settings.fileCreationTemplates.find(({ extension }) => extension === ".hiraya.todo")?.content).toBe('{\n  "schemaVersion": 2,\n  "tasks": []\n}\n');
    expect(settings.fileCreationTemplates.find(({ extension }) => extension === ".url")?.content).toBe("[InternetShortcut]\r\nURL=https://example.com\r\n");
  });

  test("matches compound extensions case-insensitively and keeps an explicit empty list", () => {
    const templates = parseFileCreationTemplates([{ extension: ".todo", mimeType: "text/plain", content: "short" }, { extension: ".hiraya.todo", mimeType: "application/json", content: "compound" }]);
    expect(fileCreationTemplate("LIST.HIRAYA.TODO", templates)?.content).toBe("compound");
    expect(parseEditorSettings({ autoSave: true, fontSize: 13, language: "auto", fileCreationTemplates: [] }).fileCreationTemplates).toEqual([]);
  });

  test("rejects duplicate extensions and oversized content", () => {
    expect(() => parseFileCreationTemplates([{ extension: ".json", mimeType: "application/json", content: "" }, { extension: ".json", mimeType: "application/json", content: "" }])).toThrow("unsupported format");
    expect(() => parseFileCreationTemplates([{ extension: ".txt", mimeType: "text/plain", content: "x".repeat(64 * 1024 + 1) }])).toThrow("unsupported format");
    expect(() => parseFileCreationTemplates([{ extension: ".txt", mimeType: "text/plain; note=\"bad\nvalue\"", content: "" }])).toThrow("unsupported format");
  });
});
