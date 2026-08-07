import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowSquareOut, Check, Copy, LinkSimple, PencilSimple, Plus, Trash, X } from "@phosphor-icons/react";
import { resolveShortLinkUrl, type ShortLink } from "../lib/short-links";

type Props = {
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
  embedded?: boolean;
  baseUrl: string;
  onBack: () => void;
  onList: () => Promise<ShortLink[]>;
  onCreate: (input: { slug?: string; destinationUrl: string }) => Promise<ShortLink>;
  onUpdate: (slug: string, input: { destinationUrl?: string; enabled?: boolean }) => Promise<ShortLink>;
  onDelete: (slug: string) => Promise<void>;
  onConfirmDelete: (link: ShortLink) => Promise<boolean>;
};

export function ShortLinksSettings({ headingRef, embedded = false, baseUrl, onBack, onList, onCreate, onUpdate, onDelete, onConfirmDelete }: Props) {
  const [links, setLinks] = useState<ShortLink[] | null>(null);
  const [error, setError] = useState("");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editDestination, setEditDestination] = useState("");
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const destinationRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setError("");
    setLinks(null);
    void onList().then(setLinks).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Short links could not be loaded."));
  };

  useEffect(load, [onList]);

  const replace = (next: ShortLink) => setLinks((current) => current?.map((link) => link.slug === next.slug ? next : link) ?? current);
  const mutate = async (slug: string, action: () => Promise<void>) => {
    setBusySlug(slug);
    setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "The short link could not be changed."); } finally { setBusySlug(null); }
  };

  return (
    <div className="settings-page short-links-page">
      {!embedded && <header className="settings-page__header">
        <button className="settings-page__back" type="button" aria-label="Back to settings" disabled={creating || busySlug !== null} onClick={onBack}><ArrowLeft size={17} /></button>
        <div><h3 ref={headingRef} tabIndex={-1}>Short Links</h3><p>Create account-wide redirects using {baseUrl}.</p></div>
      </header>}

      <section className="settings-section" aria-labelledby="short-link-create-heading">
        <div className="settings-section__heading"><Plus size={18} /><div><h3 id="short-link-create-heading">Create a short link</h3><p>Leave the custom slug blank to generate one automatically.</p></div></div>
        <form className="short-link-create" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const slug = String(data.get("slug") ?? "").trim();
          const destinationUrl = String(data.get("destinationUrl") ?? "").trim();
          setCreating(true);
          setError("");
          void onCreate({ ...(slug ? { slug } : {}), destinationUrl }).then((created) => {
            setLinks((current) => current ? [created, ...current] : [created]);
            form.reset();
            requestAnimationFrame(() => destinationRef.current?.focus());
          }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "The short link could not be created.")).finally(() => setCreating(false));
        }}>
          <label>Destination URL<input ref={destinationRef} name="destinationUrl" type="url" inputMode="url" placeholder="https://example.com/page" required disabled={creating} /></label>
          <label>Custom slug <span>Optional</span><input name="slug" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={48} pattern="[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])" title="Use 3 to 48 lowercase letters or numbers, with hyphens only between characters." placeholder="launch-notes" disabled={creating} /></label>
          <button className="button" type="submit" disabled={creating}><Plus size={16} />{creating ? "Creating..." : "Create link"}</button>
        </form>
      </section>

      <section className="settings-section" aria-labelledby="short-links-heading" aria-busy={links === null && !error}>
        <div className="settings-section__heading"><LinkSimple size={18} /><div><h3 id="short-links-heading">Your short links</h3><p>Destinations are account-scoped and work independently of the active desktop.</p></div></div>
        {error && <div className="short-links-error" role="alert"><span>{error}</span>{links === null && <button className="button button--quiet" type="button" onClick={load}>Try again</button>}</div>}
        {links === null && !error ? (
          <div className="short-links-loading" aria-label="Loading short links"><span /><span /><span /></div>
        ) : links?.length === 0 ? (
          <div className="short-links-empty"><LinkSimple size={24} /><strong>No short links yet</strong><span>Create one above to get a compact URL you can share.</span></div>
        ) : links && (
          <div className="short-links-list">
            {links.map((link) => {
              const editing = editingSlug === link.slug;
              const busy = busySlug === link.slug;
              const publicUrl = resolveShortLinkUrl(link.url, window.location.origin);
              return <article className="short-link-item" data-disabled={!link.enabled || undefined} key={link.slug}>
                <div className="short-link-item__heading"><div><strong>{link.slug}</strong><a href={publicUrl} target="_blank" rel="noreferrer">{publicUrl}<ArrowSquareOut size={13} /></a></div><label className="short-link-toggle"><span>{link.enabled ? "Enabled" : "Disabled"}</span><input type="checkbox" checked={link.enabled} disabled={busy} onChange={(event) => void mutate(link.slug, async () => replace(await onUpdate(link.slug, { enabled: event.target.checked })))} /></label></div>
                {editing ? <form className="short-link-edit" onSubmit={(event) => { event.preventDefault(); const destinationUrl = editDestination.trim(); void mutate(link.slug, async () => { replace(await onUpdate(link.slug, { destinationUrl })); setEditingSlug(null); }); }}>
                  <label htmlFor={`short-link-${link.slug}`}>Destination URL</label><input id={`short-link-${link.slug}`} type="url" required autoFocus value={editDestination} disabled={busy} onChange={(event) => setEditDestination(event.target.value)} />
                  <button className="icon-button" type="submit" aria-label={`Save ${link.slug} destination`} disabled={busy}><Check size={16} /></button><button className="icon-button" type="button" aria-label={`Cancel editing ${link.slug}`} disabled={busy} onClick={() => setEditingSlug(null)}><X size={16} /></button>
                </form> : <p className="short-link-item__destination" title={link.destinationUrl}>{link.destinationUrl}</p>}
                <div className="short-link-item__actions">
                  <button className="button button--quiet" type="button" disabled={busy} onClick={() => void (navigator.clipboard?.writeText(publicUrl) ?? Promise.reject()).then(() => { setCopiedSlug(link.slug); window.setTimeout(() => setCopiedSlug((current) => current === link.slug ? null : current), 1800); }).catch(() => setError("The browser could not copy this short link."))}>{copiedSlug === link.slug ? <Check size={15} /> : <Copy size={15} />}{copiedSlug === link.slug ? "Copied" : "Copy"}</button>
                  <a className="button button--quiet" href={publicUrl} target="_blank" rel="noreferrer"><ArrowSquareOut size={15} />Open</a>
                  <button className="button button--quiet" type="button" disabled={busy || editing} onClick={() => { setEditingSlug(link.slug); setEditDestination(link.destinationUrl); }}><PencilSimple size={15} />Edit</button>
                  <button className="button button--quiet short-link-item__delete" type="button" disabled={busy} onClick={() => void onConfirmDelete(link).then((confirmed) => { if (confirmed) return mutate(link.slug, async () => { await onDelete(link.slug); setLinks((current) => current?.filter((candidate) => candidate.slug !== link.slug) ?? current); }); })}><Trash size={15} />Delete</button>
                </div>
              </article>;
            })}
          </div>
        )}
      </section>
    </div>
  );
}
