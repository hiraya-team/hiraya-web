import { useEffect, useRef, useState } from "react";
import { Check, Desktop, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import type { DesktopIdentity } from "../types";
import { desktopCreateProtection, desktopDeleteProtection, type CatalogQuota } from "../lib/desktop-catalog";
import { RoleBadge } from "./VisualPrimitives";

type Props = {
  desktops: readonly DesktopIdentity[];
  activeDesktopId: string;
  quota?: CatalogQuota | null;
  quotaStale?: boolean;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDismiss: () => void;
  canManageDesktop?: (desktop: DesktopIdentity) => boolean;
};

function formatBytes(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} GB`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)} kB`;
  return `${value} bytes`;
}

function quotaPercent(used: number, limit: number) { return Math.min(100, used / limit * 100); }

export function DesktopSwitcher({ desktops, activeDesktopId, quota, quotaStale, onSwitch, onCreate, onRename, onDelete, onDismiss, canManageDesktop = () => true }: Props) {
  const [editing, setEditing] = useState<{ mode: "create" | "rename"; id?: string; value: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const owned = desktops.filter((desktop) => desktop.ownership === "owned");
  const shared = desktops.filter((desktop) => desktop.ownership === "shared");
  const createProtection = desktopCreateProtection(owned.length, quota);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || !editing.value.trim() || editing.mode === "create" && createProtection) return;
    setSubmitting(true);
    setError("");
    try {
      if (editing.mode === "create") await onCreate(editing.value);
      else await onRename(editing.id!, editing.value);
      setEditing(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The desktop could not be saved.");
    } finally { setSubmitting(false); }
  }

  return <aside className="desktop-switcher__rail" aria-label="Desktops" onKeyDown={(event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onDismiss();
  }}>
      <header className="desktop-switcher__rail-header">Desktops</header>
      <div className="desktop-switcher__list" role={desktops.length ? "list" : undefined}>
        {([{"label":"Your desktops","items":owned},{"label":"Shared with you","items":shared}] as const).map((group) => group.items.length > 0 && <div className="desktop-switcher__group" key={group.label}><h3>{group.label}</h3>{group.items.map((desktop) => <div className="desktop-switcher__row desktop-switcher__row--switch" role="listitem" key={desktop.id} data-active={desktop.id === activeDesktopId || undefined}>
             <button type="button" data-desktop-switch-target aria-current={desktop.id === activeDesktopId ? "true" : undefined} onClick={() => onSwitch(desktop.id)}>
                <Desktop size={18} weight="duotone" /><span><strong>{desktop.name}</strong>{desktop.ownership === "shared" && <small>{desktop.owner.displayName} · <RoleBadge>{desktop.role}</RoleBadge></small>}</span>{desktop.id === activeDesktopId && <Check size={15} />}
             </button>
         </div>)}</div>)}
       </div>
       <details className="desktop-switcher__manage"><summary>Manage desktops</summary><div className="desktop-switcher__manage-body"><div>{owned.map((desktop) => {
          const protectedReason = desktop.capabilities.delete ? desktopDeleteProtection(owned.length) : "Only the owner can delete this desktop.";
          const renameReason = desktop.capabilities.manage && !canManageDesktop(desktop) ? "Connect to rename this desktop." : "";
          const reasonId = `desktop-manage-${desktop.id.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
          return <div className="desktop-switcher__manage-row" key={desktop.id}><span><strong>{desktop.name}</strong>{(renameReason || protectedReason) && <small id={reasonId}>{[renameReason, protectedReason].filter(Boolean).join(" ")}</small>}</span>{desktop.capabilities.manage && <button type="button" className="icon-button" disabled={Boolean(renameReason)} aria-describedby={renameReason ? reasonId : undefined} aria-label={`Rename ${desktop.name}`} onClick={() => setEditing({ mode: "rename", id: desktop.id, value: desktop.name })}><PencilSimple size={15} /></button>}{desktop.capabilities.delete && <button type="button" className="icon-button" disabled={Boolean(protectedReason)} aria-describedby={protectedReason ? reasonId : undefined} title={protectedReason || `Delete ${desktop.name}`} aria-label={`Delete ${desktop.name}`} onClick={() => { setError(""); void onDelete(desktop.id).catch((deleteError) => setError(deleteError instanceof Error ? deleteError.message : "The desktop could not be deleted.")); }}><Trash size={15} /></button>}</div>;
        })}</div>{editing ? <form className="desktop-switcher__form" onSubmit={submit}>
         <label>{editing.mode === "create" ? "New desktop name" : "Rename desktop"}<input ref={inputRef} value={editing.value} maxLength={180} onChange={(event) => setEditing({ ...editing, value: event.target.value })} /></label>
         <button className="button button--primary" type="submit" disabled={submitting || !editing.value.trim() || editing.mode === "create" && Boolean(createProtection)}>{submitting ? "Saving..." : "Save"}</button>
       </form> : <button className="desktop-switcher__create" type="button" aria-disabled={Boolean(createProtection)} aria-describedby={createProtection ? "desktop-create-protection" : undefined} onClick={() => { if (!createProtection) setEditing({ mode: "create", value: `Desktop ${owned.length + 1}` }); }}><Plus size={16} /> New desktop</button>}
       {createProtection && <p id="desktop-create-protection" className="desktop-switcher__limit-note">{createProtection}</p>}
       {error && <p className="form-error" role="alert">{error}</p>}
       {quota && <section className="desktop-switcher__quota" aria-label="Account limits">
          <div className="desktop-switcher__quota-heading"><strong>Account limits</strong>{quotaStale && <span>Last synced</span>}</div>
         <div className="desktop-switcher__quota-row" data-limit={quota.storageBytes.used >= quota.storageBytes.limit || undefined}><span>Storage</span><strong>{formatBytes(quota.storageBytes.used)} / {formatBytes(quota.storageBytes.limit)}</strong><progress aria-label="Storage used" max="100" value={quotaPercent(quota.storageBytes.used, quota.storageBytes.limit)} /></div>
         <div className="desktop-switcher__quota-row" data-limit={owned.length >= quota.desktops.limit || undefined}><span>Desktops</span><strong>{owned.length.toLocaleString()} / {quota.desktops.limit.toLocaleString()}</strong><progress aria-label="Desktops used" max="100" value={quotaPercent(owned.length, quota.desktops.limit)} /></div>
         <div className="desktop-switcher__quota-row" data-limit={quota.entries.used >= quota.entries.limit || undefined}><span>Entries</span><strong>{quota.entries.used.toLocaleString()} / {quota.entries.limit.toLocaleString()}</strong><progress aria-label="Entries used" max="100" value={quotaPercent(quota.entries.used, quota.entries.limit)} /></div>
       </section>}</div></details>
  </aside>;
}
