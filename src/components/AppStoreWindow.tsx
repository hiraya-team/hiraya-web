import { useDeferredValue, useState } from "react";
import { ArrowClockwise, DownloadSimple, MagnifyingGlass, Package, Play, ShieldCheck, Trash, WarningCircle, WifiSlash, X } from "@phosphor-icons/react";
import { installedAppIsAvailable, type InstalledApp } from "../apps/installed-apps";
import { storeSearchMatches, type StorePackage } from "../lib/app-store";
import type { DesktopEntry } from "../types";
import { StatusBadge } from "./VisualPrimitives";

const LEGACY_HIRAYA_STORE_CATALOG_ID = "hiraya-app-store";

export type StorePackageView = Readonly<{
  item: StorePackage;
  name: string;
  description: string;
  version: string | null;
  appId: string | null;
  loading: boolean;
  error: string;
}>;

type Props = {
  packages: readonly StorePackageView[];
  installedApps: readonly InstalledApp[];
  entries: readonly DesktopEntry[];
  loading: boolean;
  error: string;
  offline: boolean;
  onRetry: () => void;
  onInstall: (item: StorePackage) => void;
  onLaunch: (app: InstalledApp) => void;
  onReset: (app: InstalledApp) => void;
  onUninstall: (app: InstalledApp) => void;
};

function formatBytes(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} kB`;
  return `${value} bytes`;
}

function installedSource(app: InstalledApp) {
  return app.source === "system" ? "Trusted system app" : app.source === "store" && app.sourceCatalogId === LEGACY_HIRAYA_STORE_CATALOG_ID ? "Hiraya App Store" : app.source === "store" ? "Administrator App Store" : "Desktop package";
}

function installedTrust(app: InstalledApp) {
  return app.source === "system" ? "Trusted by Hiraya" : app.source === "store" && app.sourceCatalogId === LEGACY_HIRAYA_STORE_CATALOG_ID ? "Published by Hiraya; approved in this browser" : "Approved in this browser";
}

export function AppStoreWindow({ packages, installedApps, entries, loading, error, offline, onRetry, onInstall, onLaunch, onReset, onUninstall }: Props) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searching = Boolean(deferredQuery.trim());
  const installedForView = (view: StorePackageView) => view.appId
    ? installedApps.find((app) => app.appId === view.appId)
    : installedApps.find((app) => app.source === "store" && app.packageEntryId === view.item.entry.id);
  const availablePackages = packages
    .filter((view) => !installedForView(view))
    .filter((view) => storeSearchMatches(deferredQuery, view.name, view.description, view.appId, view.version, view.item.source, "Administrator App Store"))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const installedForDisplay = installedApps
    .filter((app) => storeSearchMatches(deferredQuery, app.manifest.name, app.manifest.description, app.appId, app.version, installedSource(app)))
    .toSorted((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  const resultCount = installedForDisplay.length + (!loading && !error ? availablePackages.length : 0);
  const noMatches = searching && !loading && !error && resultCount === 0;

  return <section className="app-store" aria-labelledby="app-store-heading">
    <header className="app-store__header">
      <div><h2 id="app-store-heading">Applications</h2><p>Open and manage installed applications, or install apps published by your administrator. Updates wait for your approval.</p></div>
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
    {offline && <div className="app-store__offline" role="status"><WifiSlash size={18} weight="duotone" /><span><strong>App Store offline.</strong> Installed apps remain available; reconnect to install or update apps.</span></div>}
    {noMatches && <div className="app-store__state" role="status"><MagnifyingGlass size={30} weight="duotone" /><h4>No applications found</h4><p>Try a different name, description, app ID, source, or version.</p><button className="button button--quiet" type="button" onClick={() => setQuery("")}><X size={16} /> Clear search</button></div>}
    {!noMatches && (!searching || installedForDisplay.length > 0) && <section className="app-store__section" aria-labelledby="installed-apps-heading">
      <h3 id="installed-apps-heading">Installed</h3>
      {installedForDisplay.length > 0 ? <div className="app-store__list" role="list">
        {installedForDisplay.map((app) => {
          const available = installedAppIsAvailable(app, entries);
          const view = packages.find((candidate) => app.source === "store" && candidate.item.catalogId === app.sourceCatalogId && candidate.item.desktopId === app.sourceDesktopId && candidate.item.entry.id === app.packageEntryId)
            ?? packages.find((candidate) => candidate.appId === app.appId);
          const current = view && app.source === "store" && app.sourceCatalogId === view.item.catalogId && app.sourceDesktopId === view.item.desktopId && app.packageEntryId === view.item.entry.id && app.sourceContentRevision === view.item.contentRevision;
          const hasUpdate = Boolean(view && !current);
          const canUpdate = Boolean(hasUpdate && view && !view.loading && !view.error && !offline);
          return <article className="app-store__row app-store__row--installed" role="listitem" key={app.appId}>
            <span className="app-store__icon"><Package size={25} weight="duotone" /></span>
            <div className="app-store__copy">
              <div><h4>{app.manifest.name}</h4><StatusBadge tone={available ? "neutral" : "danger"}>{available ? `v${app.version}` : "Unavailable"}</StatusBadge></div>
              <p>{app.manifest.description ?? "No description provided."}</p>
              <small>{installedSource(app)}{view && !current ? " · Update available" : ""}</small>
              <details className="app-store__details"><summary>Details</summary><dl><div><dt>App ID</dt><dd>{app.appId}</dd></div><div><dt>Trust</dt><dd>{installedTrust(app)}</dd></div><div><dt>Scope</dt><dd>This browser and account</dd></div><div><dt>Permissions</dt><dd>{app.manifest.permissions.join(", ") || "None"}</dd></div><div><dt>Digest</dt><dd><code title={app.digest}>{app.digest.slice(0, 12)}...</code></dd></div></dl><div className="app-store__management"><button className="button button--quiet" type="button" onClick={() => onReset(app)}><ArrowClockwise size={15} /> Reset data</button>{app.source !== "system" && <button className="button button--quiet button--danger" type="button" onClick={() => onUninstall(app)}><Trash size={15} /> Uninstall</button>}</div></details>
            </div>
            <div className="app-store__actions"><button className="button button--quiet" type="button" disabled={!available} onClick={() => onLaunch(app)}><Play size={16} weight="fill" /> Open</button>{hasUpdate && view && <button className="button button--primary" type="button" disabled={!canUpdate} title={offline ? "Reconnect to update this app" : view.loading ? "Inspecting this update" : view.error || undefined} onClick={() => onInstall(view.item)}><DownloadSimple size={16} /> Update</button>}</div>
          </article>;
        })}
      </div> : <div className="app-store__state app-store__state--compact"><Package size={26} weight="duotone" /><h4>No applications installed</h4><p>Install an application below or open a <code>.hiraya.app</code> package from the desktop.</p></div>}
    </section>}
    {!noMatches && (!searching || availablePackages.length > 0 || loading || error) && <section className="app-store__section" aria-labelledby="available-apps-heading">
      <h3 id="available-apps-heading">Available from App Store</h3>
      {loading && <div className="app-store__loading" role="status"><span /><span /><span /><span className="visually-hidden">Loading the app store...</span></div>}
      {!loading && error && <div className="app-store__state app-store__state--compact" role="alert"><WarningCircle size={28} weight="duotone" /><h4>Administrator store unavailable</h4><p>{error}</p><button className="button button--quiet" type="button" onClick={onRetry}><ArrowClockwise size={16} /> Try again</button></div>}
      {!loading && !error && availablePackages.length === 0 && <div className="app-store__state app-store__state--compact"><Package size={30} weight="duotone" /><h4>{packages.length > 0 ? "All published apps are installed" : "No apps published yet"}</h4><p>{packages.length > 0 ? "New applications and updates will appear here when your administrator publishes them." : "Your administrator's published apps and available updates will appear here."}</p></div>}
      {!loading && !error && availablePackages.length > 0 && <div className="app-store__list" role="list">
      {availablePackages.map((view) => {
        const installed = installedForView(view);
        const current = installed?.source === "store" && installed.sourceCatalogId === view.item.catalogId && installed.sourceDesktopId === view.item.desktopId && installed.packageEntryId === view.item.entry.id && installed.sourceContentRevision === view.item.contentRevision;
        const launchApproved = Boolean(installed && (current || view.loading || view.error || offline));
        const retry = Boolean(view.error && !installed);
        const action = launchApproved ? "Open" : retry ? "Retry" : installed ? "Update" : "Install";
        return <article className="app-store__row" role="listitem" key={view.item.entry.id}>
          <span className="app-store__icon"><Package size={25} weight="duotone" /></span>
          <div className="app-store__copy">
            <div><h4>{view.name}</h4>{view.version && <span>v{view.version}</span>}</div>
            <p role={view.error ? "alert" : undefined}>{view.loading ? "Inspecting package..." : view.error || view.description}</p>
            <small>{formatBytes(view.item.entry.size)}{installed && !current ? " · Update available" : current ? " · Installed on this device" : ""}</small>
          </div>
          <button className={`button ${launchApproved || retry ? "button--quiet" : "button--primary"}`} type="button" disabled={!launchApproved && !retry && (view.loading || offline)} title={!launchApproved && !retry && offline ? "Reconnect to install this app" : undefined} onClick={() => launchApproved && installed ? onLaunch(installed) : retry ? onRetry() : onInstall(view.item)}>
            {launchApproved ? <Play size={16} weight="fill" /> : retry ? <ArrowClockwise size={16} /> : <DownloadSimple size={16} />}{action}
          </button>
        </article>;
      })}
    </div>}
    </section>}
  </section>;
}
