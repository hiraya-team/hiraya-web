import { useDeferredValue, useState } from "react";
import { ArrowClockwise, Desktop, MagnifyingGlass, Package, Play, ShieldCheck, Trash, WarningCircle, WifiSlash, X } from "@phosphor-icons/react";
import { installedAppIsAvailable, type InstalledApp } from "../apps/installed-apps";
import type { DesktopEntry } from "../types";
import { StatusBadge } from "./VisualPrimitives";
import type { AccountApp } from "../lib/account-apps";
import type { AccountAppOutboxRecord } from "../lib/account-app-outbox";
import { ItemList } from "./ItemList";

type Props = {
  installedApps: readonly InstalledApp[];
  entries: readonly DesktopEntry[];
  offline: boolean;
  canAddToDesktop: boolean;
  onAddToDesktop: (app: InstalledApp) => void;
  onLaunch: (app: InstalledApp) => void;
  onReset: (app: InstalledApp) => void;
  onUninstall: (app: InstalledApp) => void;
  accountApps?: readonly AccountApp[];
  accountError?: string;
  accountPending?: number;
  accountBlocked?: readonly AccountAppOutboxRecord[];
  onRetryAccount?: (operationId: string) => void;
  onDiscardAccount?: (operationId: string) => void;
  onSyncAccount?: (app: AccountApp) => void;
  onUninstallAccount?: (appId: string) => void;
};

/** Matches every search term against application metadata. */
function searchMatches(query: string, ...values: Array<string | null | undefined>) {
  const searchable = values.filter(Boolean).join(" ").toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).every((term) => searchable.includes(term));
}

/** Describes where an installed app package originated. */
function installedSource(app: InstalledApp) {
  return app.source === "system" ? "Trusted system app" : app.source === "account" ? "Synchronized account app" : "Desktop package";
}

/** Describes the trust level of an installed app package. */
function installedTrust(app: InstalledApp) {
  return app.source === "system" ? "Trusted by Hiraya" : app.source === "account" ? "Approved for this account" : "Approved in this browser";
}

/** Renders the app store window interface. */
export function AppStoreWindow({ installedApps, entries, offline, canAddToDesktop, onAddToDesktop, onLaunch, onReset, onUninstall, accountApps = [], accountError = "", accountPending = 0, accountBlocked = [], onRetryAccount = () => undefined, onDiscardAccount = () => undefined, onSyncAccount = () => undefined, onUninstallAccount = () => undefined }: Props) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searching = Boolean(deferredQuery.trim());
  const installedForDisplay = installedApps.filter((app) => searchMatches(deferredQuery, app.manifest.name, app.manifest.description, app.appId, app.version, installedSource(app)));
  const availableAccountApps = accountApps.filter((app) => searchMatches(deferredQuery, app.manifest.name, app.manifest.description, app.appId, app.manifest.version, "account"));
  const resultCount = installedForDisplay.length + availableAccountApps.length;
  const noMatches = searching && resultCount === 0;

  return <section className="app-store" aria-labelledby="app-store-heading">
    <header className="app-store__header">
      <div><h2 id="app-store-heading">Applications</h2><p>Open and manage trusted system apps, account apps, and packages approved from your desktop.</p></div>
      <span className="app-store__trust"><ShieldCheck size={17} weight="duotone" /> Sandboxed packages</span>
    </header>
    <div className="app-store__toolbar">
      <label className="activity-search app-store__search">
        <MagnifyingGlass size={16} aria-hidden="true" />
        <span className="sr-only">Search applications</span>
        <input type="search" value={query} maxLength={200} placeholder="Search apps, descriptions, or IDs" onChange={(event) => setQuery(event.target.value)} />
        {query && <button type="button" aria-label="Clear application search" onClick={() => setQuery("")}><X size={14} /></button>}
      </label>
      <span className="app-store__result-count" role="status">{searching ? `${resultCount} ${resultCount === 1 ? "result" : "results"}` : `${resultCount} ${resultCount === 1 ? "application" : "applications"}`}</span>
    </div>
    {offline && <div className="app-store__offline" role="status"><WifiSlash size={18} weight="duotone" /><span><strong>Account sync offline.</strong> Installed apps remain available; reconnect to synchronize account changes.</span></div>}
    {accountPending > 0 && <div className="app-store__offline" role="status"><ArrowClockwise size={18} /><span><strong>Account changes pending.</strong> {accountPending} {accountPending === 1 ? "change will" : "changes will"} replay in order after reconnection.</span></div>}
    {accountBlocked.map((record) => <div className="app-store__offline" role="alert" key={record.operationId}><WarningCircle size={18} /><span><strong>Account change blocked.</strong> {record.error || "The server state changed before this operation could be applied."}</span><div className="app-store__actions"><button className="button button--quiet" type="button" disabled={offline} onClick={() => onRetryAccount(record.operationId)}><ArrowClockwise size={15} /> Retry</button><button className="button button--quiet button--danger" type="button" onClick={() => onDiscardAccount(record.operationId)}><Trash size={15} /> Discard</button></div></div>)}
    {accountError && !offline && <div className="app-store__offline" role="alert"><WarningCircle size={18} /><span><strong>Account apps need attention.</strong> {accountError}</span></div>}
    {noMatches && <div className="app-store__state" role="status"><MagnifyingGlass size={30} weight="duotone" /><h4>No applications found</h4><p>Try a different name, description, app ID, source, or version.</p><button className="button button--quiet" type="button" onClick={() => setQuery("")}><X size={16} /> Clear search</button></div>}
    {!noMatches && (!searching || installedForDisplay.length > 0) && <section className="app-store__section" aria-labelledby="installed-apps-heading">
      <h3 id="installed-apps-heading">Installed</h3>
      {!canAddToDesktop && <p className="app-store__section-note" id="app-shortcut-restriction">This desktop is read only. Application shortcuts cannot be added here.</p>}
      {installedForDisplay.length > 0 ? <ItemList items={installedForDisplay} getId={(app) => app.appId} label="Installed applications" className="app-store__list" sort={{ compare: (left, right) => left.manifest.name.localeCompare(right.manifest.name), direction: "asc" }} renderItem={(app, { itemProps }) => {
        const available = installedAppIsAvailable(app, entries);
        return <article {...itemProps} className="app-store__row app-store__row--installed" role="listitem" key={app.appId}>
          <span className="app-store__icon"><Package size={25} weight="duotone" /></span>
          <div className="app-store__copy">
            <div><h4>{app.manifest.name}</h4><StatusBadge tone={available ? "neutral" : "danger"}>{available ? `v${app.version}` : "Unavailable"}</StatusBadge></div>
            <p>{app.manifest.description ?? "No description provided."}</p>
            <small>{installedSource(app)}</small>
            <details className="app-store__details"><summary>Details</summary><dl><div><dt>App ID</dt><dd>{app.appId}</dd></div><div><dt>Trust</dt><dd>{installedTrust(app)}</dd></div><div><dt>Scope</dt><dd>{app.source === "account" ? "Synchronized across this account" : "This browser and account"}</dd></div><div><dt>Permissions</dt><dd>{app.manifest.permissions.join(", ") || "None"}</dd></div><div><dt>Digest</dt><dd><code title={app.digest}>{app.digest.slice(0, 12)}...</code></dd></div></dl><div className="app-store__management"><button className="button button--quiet" type="button" onClick={() => onReset(app)}><ArrowClockwise size={15} /> Reset data</button>{app.source === "desktop" && <button className="button button--quiet button--danger" type="button" onClick={() => onUninstall(app)}><Trash size={15} /> Uninstall</button>}{app.source === "account" && <button className="button button--quiet button--danger" type="button" onClick={() => onUninstallAccount(app.appId)}><Trash size={15} /> Uninstall from account</button>}</div></details>
          </div>
          <div className="app-store__actions"><button className="button button--quiet" type="button" disabled={!available} onClick={() => onLaunch(app)}><Play size={16} weight="fill" /> Open</button><button className="button button--quiet" type="button" disabled={!available || !canAddToDesktop} aria-describedby={available && !canAddToDesktop ? "app-shortcut-restriction" : undefined} title={!available ? `${app.manifest.name} is unavailable` : !canAddToDesktop ? "This desktop is read only" : undefined} onClick={() => onAddToDesktop(app)}><Desktop size={16} /> Add to desktop</button></div>
        </article>;
      }} /> : <div className="app-store__state app-store__state--compact"><Package size={26} weight="duotone" /><h4>No applications installed</h4><p>Open a <code>.hiraya.app</code> package from the desktop to install it.</p></div>}
    </section>}
    {!noMatches && availableAccountApps.length > 0 && <section className="app-store__section" aria-labelledby="account-apps-heading">
      <h3 id="account-apps-heading">Syncing to this device</h3>
      <ItemList items={availableAccountApps} getId={(app) => app.appId} label="Applications syncing to this device" className="app-store__list" renderItem={(app, { itemProps }) => <article {...itemProps} className="app-store__row" role="listitem" key={app.appId}>
        <span className="app-store__icon"><Package size={25} weight="duotone" /></span>
        <div className="app-store__copy"><div><h4>{app.manifest.name}</h4><span>v{app.manifest.version}</span></div><p>{app.manifest.description ?? "No description provided."}</p><small>Approved for this account · Downloading and verifying locally</small></div>
        <div className="app-store__actions"><button className="button button--primary" type="button" disabled={offline} title={offline ? "Reconnect to finish synchronizing this app" : undefined} onClick={() => onSyncAccount(app)}><ArrowClockwise size={16} /> Retry sync</button><button className="button button--quiet button--danger" type="button" disabled={offline} onClick={() => onUninstallAccount(app.appId)}><Trash size={16} /> Uninstall</button></div>
      </article>} />
    </section>}
  </section>;
}
