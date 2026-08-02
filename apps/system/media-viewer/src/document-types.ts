export type ParsedDocumentKind = "docx" | "rtf";

export const MAX_PARSED_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const RTF_MIMES = new Set(["application/rtf", "text/rtf"]);

export function normalizedMime(mimeType: string): string {
  return mimeType.split(";", 1)[0].trim().toLowerCase();
}

export function parsedDocumentKind(name: string, mimeType: string): ParsedDocumentKind | null {
  const lowerName = name.toLowerCase();
  const mime = normalizedMime(mimeType);
  if (lowerName.endsWith(".docx") || mime === DOCX_MIME) return "docx";
  if (lowerName.endsWith(".rtf") || RTF_MIMES.has(mime)) return "rtf";
  return null;
}
