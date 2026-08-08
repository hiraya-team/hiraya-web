import DOMPurify from "dompurify";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";

const SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true },
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ["form", "button", "textarea", "select", "option", "style"],
  FORBID_ATTR: ["style", "srcset", "action", "formaction", "ping"],
};

function isSafeRelative(value: string) {
  return Boolean(value) && !/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(value) && !value.includes("\\");
}

export function markdownRelativePath(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return isSafeRelative(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function markdownResourceKind(value: string): "external" | "relative" | "blocked" {
  if (/^https?:\/\//i.test(value)) return "external";
  return markdownRelativePath(value) ? "relative" : "blocked";
}

export function markdownHtml(source: string): string {
  return micromark(source, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
}

export function renderMarkdown(source: string): HTMLElement {
  const article = document.createElement("article");
  article.className = "markdown-page";
  article.setAttribute("aria-label", "Markdown preview");
  const content = DOMPurify.sanitize(markdownHtml(source), { ...SANITIZE_OPTIONS, RETURN_DOM_FRAGMENT: true });

  for (const link of Array.from(content.querySelectorAll<HTMLAnchorElement>("a"))) {
    const href = link.getAttribute("href") ?? "";
    if (/^(?:https?:|mailto:)/i.test(href)) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } else if (!href.startsWith("#")) {
      link.removeAttribute("href");
      const relativePath = markdownRelativePath(href);
      if (relativePath) link.dataset.relativeHref = relativePath;
    }
  }

  for (const image of Array.from(content.querySelectorAll<HTMLImageElement>("img"))) {
    const source = image.getAttribute("src") ?? "";
    image.removeAttribute("src");
    const kind = markdownResourceKind(source);
    if (kind === "external") image.dataset.externalSrc = source;
    else if (kind === "relative") image.dataset.relativeSrc = markdownRelativePath(source)!;
    else image.replaceWith(document.createTextNode(`[Blocked image: ${image.alt || source}]`));
  }

  content.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
    if (input.type !== "checkbox") input.remove();
    else input.disabled = true;
  });
  article.append(content);
  return article;
}
