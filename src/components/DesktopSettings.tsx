import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, DotsSixVertical, PencilSimple, Plus, PushPin, Trash } from "@phosphor-icons/react";
import type { DesktopIdentity } from "../types";
import { desktopCreateProtection, desktopDeleteProtection, type CatalogQuota } from "../lib/desktop-catalog";
import { desktopPreferences, moveDesktopPreference, pinDesktopPreference, type DesktopPreference } from "../lib/desktop-preferences";
import { RoleBadge } from "./VisualPrimitives";
import { ItemList } from "./ItemList";

type Props = {
  desktops: readonly DesktopIdentity[];
  activeDesktopId: string;
  quota: CatalogQuota | null;
  quotaStale: boolean;
  arrangementDisabled: boolean;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onArrange: (desktops: DesktopPreference[]) => Promise<void>;
  canManageDesktop: (desktop: DesktopIdentity) => boolean;
};

/** Formats bytes for display. */
function formatBytes(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} GB`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)} kB`;
  return `${value} bytes`;
}

/** Calculates the bounded percentage of storage quota in use. */
function quotaPercent(used: number, limit: number) { return Math.min(100, used / limit * 100); }

/** Renders the desktop settings interface. */
export function DesktopSettings({ desktops, activeDesktopId, quota, quotaStale, arrangementDisabled, onCreate, onRename, onDelete, onArrange, canManageDesktop }: Props) {
  const [draft, setDraft] = useState(() => desktopPreferences(desktops));
  const [editing, setEditing] = useState<{ mode: "create" | "rename"; id?: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const owned = desktops.filter((desktop) => desktop.ownership === "owned");
  const createProtection = desktopCreateProtection(owned.length, quota);
  const ordered = draft.flatMap((preference) => {
    const desktop = desktops.find((candidate) => candidate.id === preference.id);
    return desktop ? [{ ...desktop, pinned: preference.pinned }] : [];
  });

  useEffect(() => { setDraft(desktopPreferences(desktops)); }, [desktops]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  async function commit(next: DesktopPreference[]) {
    const previous = draft;
    setBusy(true);
    setDraft(next);
    setError("");
    try { await onArrange(next); }
    catch (reason) {
      setDraft(previous);
      setError(reason instanceof Error ? reason.message : "The desktop order could not be saved.");
    } finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing?.value.trim() || editing.mode === "create" && createProtection) return;
    setBusy(true);
    setError("");
    try {
      if (editing.mode === "create") await onCreate(editing.value);
      else await onRename(editing.id!, editing.value);
      setEditing(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The desktop could not be saved.");
    } finally { setBusy(false); }
  }

  function move(id: string, direction: -1 | 1) {
    if (arrangementDisabled || busy) return;
    const next = moveDesktopPreference(draft, id, direction);
    if (next.some((item, index) => item.id !== draft[index]?.id)) void commit(next);
  }

  return <div className="desktop-settings">
    <div className="desktop-settings__toolbar">
      <div><strong>{desktops.length.toLocaleString()} accessible</strong><span>{owned.length.toLocaleString()} owned · {(desktops.length - owned.length).toLocaleString()} shared</span></div>
      <button className="button button--primary" type="button" aria-disabled={Boolean(createProtection)} aria-describedby={createProtection ? "desktop-create-protection" : undefined} onClick={() => { if (!createProtection) setEditing({ mode: "create", value: `Desktop ${owned.length + 1}` }); }}><Plus size={16} /> New desktop</button>
    </div>
    {createProtection && <p id="desktop-create-protection" className="desktop-settings__note">{createProtection}</p>}
    {arrangementDisabled && <p className="desktop-settings__note" role="status">Pinned desktops and order are shown from the last sync. Reconnect to change them.</p>}
    {editing && <form className="desktop-settings__form" onSubmit={submit}>
      <label>{editing.mode === "create" ? "New desktop name" : "Rename desktop"}<input ref={inputRef} value={editing.value} maxLength={180} onChange={(event) => setEditing({ ...editing, value: event.target.value })} /></label>
      <div><button className="button button--quiet" type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="button button--primary" type="submit" disabled={busy || !editing.value.trim()}>{busy ? "Saving..." : "Save"}</button></div>
    </form>}
    <ItemList items={ordered} getId={(desktop) => desktop.id} label="Desktop order" className="desktop-settings__list" reorder={arrangementDisabled || busy ? undefined : {
      canMove: (desktop, _fromIndex, toIndex, items) => items[toIndex]?.pinned === desktop.pinned,
      onChange: (next) => void commit(next.map(({ id, pinned }) => ({ id, pinned }))),
    }} renderItem={(desktop, { index, itemProps, reorderHandleProps }) => {
        const previous = ordered[index - 1];
        const next = ordered[index + 1];
        const managementReason = desktop.capabilities.manage && !canManageDesktop(desktop) ? "Connect to rename this shared desktop." : "";
        const deleteReason = desktop.capabilities.delete ? desktopDeleteProtection(owned.length) : "Only the owner can delete this desktop.";
        const reasonId = `desktop-settings-${desktop.id.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
        return <article {...itemProps} className="desktop-settings__row" data-active={desktop.id === activeDesktopId || undefined} key={desktop.id}>
          <button {...reorderHandleProps} className="desktop-settings__drag" type="button" aria-label={`Reorder ${desktop.name}`} disabled={arrangementDisabled || busy}><DotsSixVertical size={19} /></button>
          <div className="desktop-settings__identity"><div><strong>{desktop.name}</strong>{desktop.id === activeDesktopId && <span className="desktop-settings__active"><Check size={13} /> Active</span>}</div><small>{desktop.ownership === "owned" ? "Owned by you" : `Owned by ${desktop.owner.displayName}`} <RoleBadge>{desktop.role}</RoleBadge></small>{(managementReason || deleteReason) && <span id={reasonId}>{[managementReason, desktop.capabilities.delete ? deleteReason : ""].filter(Boolean).join(" ")}</span>}</div>
          <div className="desktop-settings__arrange">
            <button className="icon-button" type="button" aria-label={desktop.pinned ? `Unpin ${desktop.name}` : `Pin ${desktop.name}`} aria-pressed={desktop.pinned} disabled={arrangementDisabled || busy} onClick={() => void commit(pinDesktopPreference(draft, desktop.id, !desktop.pinned))}><PushPin size={16} weight={desktop.pinned ? "fill" : "regular"} /></button>
            <button className="icon-button" type="button" aria-label={`Move ${desktop.name} up`} disabled={arrangementDisabled || busy || !previous || previous.pinned !== desktop.pinned} onClick={() => move(desktop.id, -1)}><ArrowUp size={16} /></button>
            <button className="icon-button" type="button" aria-label={`Move ${desktop.name} down`} disabled={arrangementDisabled || busy || !next || next.pinned !== desktop.pinned} onClick={() => move(desktop.id, 1)}><ArrowDown size={16} /></button>
          </div>
          <div className="desktop-settings__manage">
            {desktop.capabilities.manage && <button className="icon-button" type="button" aria-label={`Rename ${desktop.name}`} aria-describedby={managementReason ? reasonId : undefined} disabled={busy || Boolean(managementReason)} onClick={() => setEditing({ mode: "rename", id: desktop.id, value: desktop.name })}><PencilSimple size={16} /></button>}
            {desktop.capabilities.delete && <button className="icon-button" type="button" aria-label={`Delete ${desktop.name}`} aria-describedby={deleteReason ? reasonId : undefined} disabled={busy || Boolean(deleteReason)} onClick={() => { setError(""); void onDelete(desktop.id).catch((reason) => setError(reason instanceof Error ? reason.message : "The desktop could not be deleted.")); }}><Trash size={16} /></button>}
          </div>
        </article>;
      }} />
    {error && <p className="form-error" role="alert">{error}</p>}
    {quota && <section className="desktop-settings__quota" aria-label="Account limits">
      <div className="desktop-settings__quota-heading"><strong>Account limits</strong>{quotaStale && <span>Last synced</span>}</div>
      <div className="desktop-settings__quota-grid">
        {[["Storage", quota.storageBytes.used, quota.storageBytes.limit, `${formatBytes(quota.storageBytes.used)} / ${formatBytes(quota.storageBytes.limit)}`], ["Desktops", owned.length, quota.desktops.limit, `${owned.length.toLocaleString()} / ${quota.desktops.limit.toLocaleString()}`], ["Entries", quota.entries.used, quota.entries.limit, `${quota.entries.used.toLocaleString()} / ${quota.entries.limit.toLocaleString()}`]] .map(([label, used, limit, value]) => <div className="desktop-settings__quota-row" data-limit={Number(used) >= Number(limit) || undefined} key={String(label)}><span>{label}</span><strong>{value}</strong><progress aria-label={`${label} used`} max="100" value={quotaPercent(Number(used), Number(limit))} /></div>)}
      </div>
    </section>}
  </div>;
}
