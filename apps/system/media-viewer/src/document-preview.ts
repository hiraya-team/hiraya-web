import DOMPurify from "dompurify";
import mammoth from "mammoth";
import { RTFJS } from "rtf.js";
import type { ParsedDocumentKind } from "./document-types";

const SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true },
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^data:image\/(?:gif|jpeg|png|webp);base64,/i,
  FORBID_TAGS: ["form", "input", "button", "textarea", "select", "option", "style"],
  FORBID_ATTR: ["href", "srcset", "action", "formaction", "ping", "target"],
};

function sanitizedPage(html: string): HTMLElement {
  const page = document.createElement("article");
  page.className = "document-page";
  page.setAttribute("aria-label", "Document preview");
  const content = DOMPurify.sanitize(html, { ...SANITIZE_OPTIONS, RETURN_DOM_FRAGMENT: true });
  content.querySelectorAll<HTMLElement>("[style]").forEach((element) => {
    if (/url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding/i.test(element.getAttribute("style") ?? "")) element.removeAttribute("style");
  });
  page.append(content);
  return page;
}

export async function renderParsedDocument(kind: ParsedDocumentKind, data: ArrayBuffer): Promise<HTMLElement> {
  if (kind === "docx") {
    const result = await mammoth.convertToHtml({ arrayBuffer: data }, { externalFileAccess: false, includeEmbeddedStyleMap: false });
    return sanitizedPage(result.value);
  }

  const rtf = new RTFJS.Document(data, {
    onImport: (_url, callback) => callback({ error: new Error("External RTF resources are blocked.") }),
  });
  const source = document.createElement("div");
  source.append(...await rtf.render());
  return sanitizedPage(source.innerHTML);
}
