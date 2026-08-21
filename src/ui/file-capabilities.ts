import type { EditorLanguage, FileEntry } from "../types";
import { APP_SHORTCUT_MIME_TYPE } from "../lib/app-shortcut";

export type FilePreviewKind = "text" | "markdown" | "url" | "image" | "pdf" | "video" | "audio" | "none";
export type FileIconKind = "app" | "code" | "text" | "url" | "image" | "pdf" | "video" | "audio" | "archive" | "file";

/** Maps file extensions to editor language modes. */
const EXTENSION_LANGUAGES: Readonly<Record<string, EditorLanguage>> = {
  css: "css",
  htm: "html",
  html: "html",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  ts: "typescript",
  tsx: "tsx",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

/** Lists extensions treated as editable plain text. */
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "json", "js", "jsx", "ts", "tsx", "css", "html", "xml", "csv", "yaml", "yml"]);
/** Lists extensions treated as source code. */
const CODE_EXTENSIONS = new Set(["js", "jsx", "ts", "tsx", "css", "html", "json", "md"]);

/** Extracts a normalized extension from a file name. */
export function fileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

/** Selects an editor language from a file name and preference. */
export function editorLanguageFor(fileName: string, language: EditorLanguage) {
  return language === "auto" ? EXTENSION_LANGUAGES[fileExtension(fileName)] ?? "plain" : language;
}

/** Derives editing and preview capabilities from a file. */
export function fileCapabilities(file: FileEntry) {
  const extension = fileExtension(file.name);
  const mimeType = file.mimeType.toLowerCase();
  const scenePackage = file.name.toLowerCase().endsWith(".hiraya.scene");
  const appShortcut = mimeType.split(";", 1)[0].trim() === APP_SHORTCUT_MIME_TYPE;
  const urlShortcut = extension === "url";
  const markdown = extension === "md" || extension === "markdown" || mimeType.split(";", 1)[0].trim() === "text/markdown";
  const editable = !appShortcut && !scenePackage && (urlShortcut || mimeType.startsWith("text/") || mimeType.includes("json") || TEXT_EXTENSIONS.has(extension));
  const preview: FilePreviewKind = urlShortcut ? "url"
    : markdown ? "markdown"
    : editable ? "text"
    : mimeType.startsWith("image/") ? "image"
      : mimeType === "application/pdf" ? "pdf"
        : mimeType.startsWith("video/") ? "video"
          : mimeType.startsWith("audio/") ? "audio"
            : "none";
  const icon: FileIconKind = appShortcut ? "app"
    : scenePackage ? "archive"
    : urlShortcut ? "url"
    : mimeType.startsWith("image/") ? "image"
    : mimeType.startsWith("video/") ? "video"
      : mimeType.startsWith("audio/") ? "audio"
        : mimeType === "application/pdf" ? "pdf"
          : mimeType.includes("zip") || mimeType.includes("compressed") ? "archive"
            : CODE_EXTENSIONS.has(extension) ? "code"
              : editable ? "text"
                : "file";

  return { editable, preview, icon } as const;
}
