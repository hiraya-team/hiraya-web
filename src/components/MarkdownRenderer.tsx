import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FileEntry } from "../types";

type Props = {
  content: string;
  externalEmbeddedPreviews: boolean;
  onResolveLink: (path: string) => Promise<{ file: FileEntry; blob: Blob }>;
  onOpenLinkedFile: (file: FileEntry) => void;
  onLinkError?: (message: string) => void;
  onAnchorLink?: (href: string) => void;
};

function isExternalLink(value: string) { return /^(?:https?:|mailto:)/i.test(value); }
function isExternalImage(value: string) { return /^https?:\/\//i.test(value); }
function hasScheme(value: string) { return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value); }

function LocalImage({ src, alt, externalEmbeddedPreviews, onResolveLink }: {
  src: string;
  alt: string;
  externalEmbeddedPreviews: boolean;
  onResolveLink: Props["onResolveLink"];
}) {
  const [resolvedSrc, setResolvedSrc] = useState("");
  const [loadOnce, setLoadOnce] = useState(false);
  useEffect(() => {
    if (isExternalImage(src)) {
      setResolvedSrc(externalEmbeddedPreviews || loadOnce ? src : "");
      return;
    }
    if (hasScheme(src) || src.startsWith("/")) { setResolvedSrc(""); return; }
    let active = true;
    let objectUrl = "";
    void onResolveLink(src).then(({ blob }) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setResolvedSrc(objectUrl);
    }).catch(() => setResolvedSrc(""));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [externalEmbeddedPreviews, loadOnce, onResolveLink, src]);

  if (resolvedSrc) return <img src={resolvedSrc} alt={alt} />;
  if (isExternalImage(src)) {
    let host = "external site";
    try { host = new URL(src).host; } catch { /* URL shape is checked above. */ }
    return <span className="markdown-renderer__missing-media">External image blocked from {host}. <button type="button" className="button button--quiet" onClick={() => setLoadOnce(true)}>Load once</button></span>;
  }
  return <span className="markdown-renderer__missing-media">{alt || src}</span>;
}

function headingId(children: ReactNode) {
  const text = Children.toArray(children).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (isValidElement<{ children?: ReactNode }>(child)) return Children.toArray(child.props.children).join("");
    return "";
  }).join("");
  const explicit = text.match(/\s*\{#([a-z][a-z0-9-]*)\}\s*$/);
  return explicit?.[1] ?? text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function headingChildren(children: ReactNode) {
  return Children.map(children, (child) => typeof child === "string" ? child.replace(/\s*\{#[a-z][a-z0-9-]*\}\s*$/, "") : child);
}

export function MarkdownRenderer({ content, externalEmbeddedPreviews, onResolveLink, onOpenLinkedFile, onLinkError, onAnchorLink }: Props) {
  const [linkError, setLinkError] = useState("");
  const linkGenerationRef = useRef(0);

  useEffect(() => {
    linkGenerationRef.current += 1;
  }, [content]);

  async function openLocalLink(href: string) {
    const generation = ++linkGenerationRef.current;
    setLinkError("");
    onLinkError?.("");
    try {
      const { file } = await onResolveLink(href);
      if (linkGenerationRef.current !== generation) return;
      onOpenLinkedFile(file);
    } catch (error) {
      if (linkGenerationRef.current !== generation) return;
      const message = error instanceof Error ? error.message : `Could not open ${href}.`;
      setLinkError(message);
      onLinkError?.(message);
    }
  }

  return (
    <article className="markdown-renderer">
      {linkError && !onLinkError && <p className="markdown-renderer__missing-media" role="alert">{linkError}</p>}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 id={headingId(children)}>{headingChildren(children)}</h1>,
          h2: ({ children }) => <h2 id={headingId(children)}>{headingChildren(children)}</h2>,
          h3: ({ children }) => <h3 id={headingId(children)}>{headingChildren(children)}</h3>,
          h4: ({ children }) => <h4 id={headingId(children)}>{headingChildren(children)}</h4>,
          a: ({ href = "", children }: { href?: string; children?: ReactNode }) => isExternalLink(href) || href.startsWith("#")
            ? <a href={href} target={isExternalLink(href) ? "_blank" : undefined} rel={isExternalLink(href) ? "noopener noreferrer" : undefined} onClick={href.startsWith("#") && onAnchorLink ? (event) => { event.preventDefault(); onAnchorLink(href); } : undefined}>{children}</a>
            : hasScheme(href) || href.startsWith("/") ? <span>{children}</span>
            : <a href={href} onClick={(event) => { event.preventDefault(); void openLocalLink(href); }}>{children}</a>,
          img: ({ src = "", alt = "" }: { src?: string; alt?: string }) => (
            <LocalImage src={src} alt={alt} externalEmbeddedPreviews={externalEmbeddedPreviews} onResolveLink={onResolveLink} />
          ),
        }}
      >{content}</ReactMarkdown>
    </article>
  );
}
