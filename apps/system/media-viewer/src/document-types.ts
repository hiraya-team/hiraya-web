export type ParsedDocumentKind = "docx" | "rtf";

/** Defines the maximum parsed document size. */
export const MAX_PARSED_DOCUMENT_BYTES = 8 * 1024 * 1024;
/** Identifies the DOCX MIME type. */
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** Lists supported RTF MIME types. */
export const RTF_MIMES = new Set(["application/rtf", "text/rtf"]);

/** Normalizes a MIME type without parameters. */
export function normalizedMime(mimeType: string): string {
  return mimeType.split(";", 1)[0].trim().toLowerCase();
}

/** Detects a supported parsed-document format. */
export function parsedDocumentKind(name: string, mimeType: string): ParsedDocumentKind | null {
  const lowerName = name.toLowerCase();
  const mime = normalizedMime(mimeType);
  if (lowerName.endsWith(".docx") || mime === DOCX_MIME) return "docx";
  if (lowerName.endsWith(".rtf") || RTF_MIMES.has(mime)) return "rtf";
  return null;
}

/** Reports whether a file is a supported Markdown document. */
export function isMarkdownDocument(name: string, mimeType: string): boolean {
  const lowerName = name.toLowerCase();
  const mime = normalizedMime(mimeType);
  return lowerName.endsWith(".md") || lowerName.endsWith(".markdown") || mime === "text/markdown" || mime === "text/plain";
}
