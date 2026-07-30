import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const PROJECT_FILE = "hiraya.project.json";
export const SITE_CSS_FILE = "site.css";
export const OUTPUT_PATH = "dist/index.html";
export const MAX_PUBLICATION_BYTES = 32 * 1024 * 1024;

export type ProjectPage = Readonly<{ path: string; title: string }>;
export type ProjectDefinition = Readonly<{
  schemaVersion: 1;
  title: string;
  description?: string;
  pages: ProjectPage[];
}>;

export type PublicationInput = Readonly<{
  project: ProjectDefinition;
  pages: ReadonlyMap<string, string>;
  assets: ReadonlyMap<string, string>;
  siteCss?: string;
  preview?: boolean;
}>;

const SAFE_SEGMENT = /^(?!\.\.?$)[^/\\]+$/;
const RASTER_EXTENSION = /\.(?:avif|gif|jpe?g|png|webp)$/i;

export function parseProject(value: unknown): ProjectDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${PROJECT_FILE} must contain a JSON object.`);
  const object = value as Record<string, unknown>;
  const allowed = new Set(["schemaVersion", "title", "description", "pages"]);
  if (Object.keys(object).some((key) => !allowed.has(key))) throw new Error(`${PROJECT_FILE} contains an unsupported field.`);
  if (object.schemaVersion !== 1) throw new Error(`${PROJECT_FILE} must use schemaVersion 1.`);
  const title = requiredText(object.title, "Project title", 120);
  const description = object.description === undefined ? undefined : requiredText(object.description, "Project description", 300);
  if (!Array.isArray(object.pages) || object.pages.length === 0 || object.pages.length > 100) throw new Error("A project must list between 1 and 100 pages.");
  const seen = new Set<string>();
  const pages = object.pages.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Page ${index + 1} must be an object.`);
    const page = item as Record<string, unknown>;
    if (Object.keys(page).some((key) => key !== "path" && key !== "title")) throw new Error(`Page ${index + 1} contains an unsupported field.`);
    const path = requiredText(page.path, `Page ${index + 1} path`, 500);
    const pageTitle = requiredText(page.title, `Page ${index + 1} title`, 120);
    if (!isSafeProjectPath(path) || !path.toLowerCase().endsWith(".md") || path.startsWith("dist/")) throw new Error(`Page path "${path}" must be a safe Markdown path outside dist/.`);
    const folded = path.toLocaleLowerCase();
    if (seen.has(folded)) throw new Error(`Page path "${path}" is listed more than once.`);
    seen.add(folded);
    return { path, title: pageTitle };
  });
  return { schemaVersion: 1, title, ...(description === undefined ? {} : { description }), pages };
}

export function parseProjectText(text: string): ProjectDefinition {
  try {
    return parseProject(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${PROJECT_FILE} is not valid JSON.`);
    throw error;
  }
}

export function serializeProject(project: ProjectDefinition): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function isSafeProjectPath(path: string): boolean {
  return path.length > 0 && path.length <= 500 && !path.startsWith("/") && !path.includes("\\") && path.split("/").every(isSafeSegment);
}

export function resolveProjectPath(sourcePath: string, target: string): string | null {
  const withoutHash = target.split(/[?#]/, 1)[0];
  if (!withoutHash || /^(?:[a-z][a-z\d+.-]*:|\/|\\|#)/i.test(target)) return null;
  const parts = sourcePath.split("/").slice(0, -1);
  for (const part of withoutHash.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    if (!isSafeSegment(part)) return null;
    parts.push(part);
  }
  const result = parts.join("/");
  return isSafeProjectPath(result) ? result : null;
}

export function markdownAssetPaths(sourcePath: string, markdown: string): string[] {
  const paths = new Set<string>();
  for (const match of markdown.matchAll(/!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g)) {
    const resolved = resolveProjectPath(sourcePath, match[1] ?? match[2] ?? "");
    if (resolved && RASTER_EXTENSION.test(resolved)) paths.add(resolved);
  }
  return [...paths];
}

export function buildPublication({ project, pages, assets, siteCss = "", preview = false }: PublicationInput): string {
  const routeByPath = new Map(project.pages.map((page, index) => [page.path, routeForPage(page, index)]));
  const articles = project.pages.map((page, index) => {
    const source = pages.get(page.path);
    if (source === undefined) throw new Error(`Missing page source: ${page.path}`);
    const route = routeByPath.get(page.path)!;
    const content = renderToStaticMarkup(
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href = "", children }) => renderLink(page.path, href, children, routeByPath),
          img: ({ src = "", alt = "" }) => renderImage(page.path, src, alt, assets),
        }}
      >{source}</ReactMarkdown>,
    );
    return `<article data-route="${escapeAttribute(route)}"${index === 0 ? "" : " hidden"}><h1 class="publication-page-title">${escapeHtml(page.title)}</h1>${content}</article>`;
  }).join("");
  const navigation = project.pages.map((page, index) => `<a href="#/${escapeAttribute(routeForPage(page, index))}">${escapeHtml(page.title)}</a>`).join("");
  const description = project.description ? `<p class="publication-description">${escapeHtml(project.description)}</p>` : "";
  const previewGuard = preview ? `document.addEventListener("click",event=>{const link=event.target.closest("a");if(link&&/^(?:https?:|mailto:)/i.test(link.href))event.preventDefault()});` : "";
  const router = `(()=>{const show=()=>{const route=decodeURIComponent(location.hash.replace(/^#\\/?/,""));const pages=[...document.querySelectorAll("[data-route]")];let active=pages.find(page=>page.dataset.route===route)||pages[0];for(const page of pages)page.hidden=page!==active;for(const link of document.querySelectorAll("nav a"))link.toggleAttribute("aria-current",link.getAttribute("href")==="#/"+active.dataset.route)};addEventListener("hashchange",show);show();${previewGuard}})();`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:"><title>${escapeHtml(project.title)}</title><style>${PUBLICATION_CSS}\n${safeStyleText(siteCss)}</style></head><body><header><a class="publication-title" href="#/">${escapeHtml(project.title)}</a>${description}<nav aria-label="Publication pages">${navigation}</nav></header><main>${articles}</main><script>${router}</script></body></html>`;
}

function renderLink(sourcePath: string, href: string, children: ReactNode, routes: ReadonlyMap<string, string>): ReactNode {
  if (/^(?:https?:|mailto:)/i.test(href)) return <a href={href} rel="noopener noreferrer">{children}</a>;
  if (href.startsWith("#")) return <a href={href}>{children}</a>;
  const resolved = resolveProjectPath(sourcePath, href);
  const route = resolved ? routes.get(resolved) : undefined;
  return route ? <a href={`#/${route}`}>{children}</a> : <span className="publication-missing-link">{children}</span>;
}

function renderImage(sourcePath: string, src: string, alt: string, assets: ReadonlyMap<string, string>): ReactNode {
  const resolved = resolveProjectPath(sourcePath, src);
  const data = resolved ? assets.get(resolved) : undefined;
  return data ? <img src={data} alt={alt} loading="lazy" /> : <span className="publication-missing-image">[Image unavailable: {alt || src}]</span>;
}

function routeForPage(page: ProjectPage, index: number): string {
  if (index === 0) return "";
  return page.path.replace(/\.md$/i, "").split("/").map((part) => encodeURIComponent(part)).join("/");
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} must contain between 1 and ${max} characters.`);
  return value.trim();
}

function isSafeSegment(value: string): boolean {
  return SAFE_SEGMENT.test(value) && ![...value].some((character) => character.codePointAt(0)! < 32);
}

function safeStyleText(value: string): string {
  return value.replace(/<\/style/gi, "<\\/style");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

const PUBLICATION_CSS = `
:root{color-scheme:light dark;font-family:ui-serif,Georgia,Cambria,"Times New Roman",serif;background:#f4f1e8;color:#25231f}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f4f1e8;color:#25231f}header{position:sticky;top:0;z-index:1;padding:1rem clamp(1rem,4vw,3rem);border-bottom:1px solid #cfc8b8;background:#f4f1e8f2;backdrop-filter:blur(14px)}.publication-title{color:inherit;font:700 clamp(1.25rem,3vw,1.8rem)/1.2 ui-sans-serif,system-ui,sans-serif;text-decoration:none}.publication-description{max-width:65ch;margin:.35rem 0;color:#625e55;font:400 .95rem/1.5 ui-sans-serif,system-ui,sans-serif}nav{display:flex;gap:.35rem 1rem;margin-top:.85rem;overflow:auto;font:600 .85rem/1.4 ui-sans-serif,system-ui,sans-serif}nav a{padding:.35rem 0;color:#5a4a24;text-decoration:none;white-space:nowrap}nav a[aria-current]{box-shadow:inset 0 -2px #a66f0a}main{width:min(100% - 2rem,72ch);margin:clamp(2rem,7vw,5rem) auto 6rem}article{font-size:clamp(1rem,2vw,1.12rem);line-height:1.75}.publication-page-title{margin:0 0 2rem;font:750 clamp(2rem,7vw,4.5rem)/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:-.035em;text-wrap:balance}h2,h3,h4{margin:2.5em 0 .65em;font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.2}p,ul,ol,blockquote,pre,table{margin:0 0 1.35em}a{color:#7a5209;text-underline-offset:.18em}img{display:block;max-width:100%;height:auto;margin:2rem auto}blockquote{margin-left:0;padding-left:1rem;border-left:1px solid #a66f0a;color:#5d584e}pre{padding:1rem;overflow:auto;border:1px solid #cbc3b3;border-radius:.4rem;background:#ebe6da}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}table{width:100%;border-collapse:collapse;display:block;overflow:auto}th,td{padding:.55rem .75rem;border:1px solid #cbc3b3;text-align:left}.publication-missing-link,.publication-missing-image{color:#8c2f26;text-decoration:line-through}@media(prefers-color-scheme:dark){:root,body{background:#181b19;color:#e8e5dc}header{border-color:#3d423e;background:#181b19f2}.publication-description{color:#aaa9a2}nav a,a{color:#e2ae4e}pre{border-color:#424741;background:#222724}blockquote{color:#b8b7af}}@media(prefers-reduced-motion:no-preference){article:not([hidden]){animation:publication-in .18s cubic-bezier(.2,.8,.2,1)}}@keyframes publication-in{from{opacity:.65;transform:translateY(4px)}to{opacity:1;transform:none}}
`;
