import { describe, expect, test } from "bun:test";
import { DOCX_MIME, MAX_PARSED_DOCUMENT_BYTES, normalizedMime, parsedDocumentKind } from "./document-types";
import { renderParsedDocument } from "./document-preview";

describe("document preview safeguards", () => {
  test("recognizes only DOCX and RTF MIME types or extensions after MIME normalization", () => {
    expect(normalizedMime(`${DOCX_MIME}; charset=binary`)).toBe(DOCX_MIME);
    expect(parsedDocumentKind("report.bin", `${DOCX_MIME}; charset=binary`)).toBe("docx");
    expect(parsedDocumentKind("notes.RTF", "application/octet-stream")).toBe("rtf");
    expect(parsedDocumentKind("notes.bin", "text/rtf; charset=windows-1252")).toBe("rtf");
    expect(parsedDocumentKind("legacy.doc", "application/msword")).toBeNull();
    expect(MAX_PARSED_DOCUMENT_BYTES).toBe(8 * 1024 * 1024);
  });

  test("uses a CSP-compatible sandboxed iframe for PDF and sanitizes converted documents", async () => {
    const source = await Bun.file(new URL("./main.ts", import.meta.url)).text();
    const conversion = await Bun.file(new URL("./document-preview.ts", import.meta.url)).text();
    expect(source).toContain('document.createElement("iframe")');
    expect(source).toContain('frame.setAttribute("sandbox", "")');
    expect(source).not.toContain('document.createElement("object")');
    expect(conversion).toContain("DOMPurify.sanitize");
    expect(conversion).toContain('FORBID_ATTR: ["href", "srcset", "action", "formaction", "ping", "target"]');
    expect(conversion).toContain("externalFileAccess: false");
    expect(conversion).toContain("External RTF resources are blocked.");
  });

  test("rejects malformed DOCX input", async () => {
    await expect(renderParsedDocument("docx", new TextEncoder().encode("not a zip").buffer)).rejects.toThrow();
  });
});
