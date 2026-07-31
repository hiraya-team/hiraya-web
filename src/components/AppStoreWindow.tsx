import { ArrowClockwise, DownloadSimple, Package, Play, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import type { InstalledApp } from "../apps/installed-apps";
import type { StorePackage } from "../lib/app-store";

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
  loading: boolean;
  error: string;
  offline: boolean;
  onRetry: () => void;
  onInstall: (item: StorePackage) => void;
  onLaunch: (app: InstalledApp) => void;
};

function formatBytes(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} kB`;
  return `${value} bytes`;
}

export function AppStoreWindow({ packages, installedApps, loading, error, offline, onRetry, onInstall, onLaunch }: Props) {
  return <section className="app-store" aria-labelledby="app-store-heading">
    <header className="app-store__header">
      <div><h2 id="app-store-heading">Apps for your desktop</h2><p>Install administrator-published apps. Updates wait for your approval.</p></div>
      <span className="app-store__trust"><ShieldCheck size={17} weight="duotone" /> Sandboxed packages</span>
    </header>
    {loading && <div className="app-store__loading" role="status"><span /><span /><span /><span className="visually-hidden">Loading the app store...</span></div>}
    {!loading && error && <div className="app-store__state" role="alert"><WarningCircle size={28} weight="duotone" /><h3>Store unavailable</h3><p>{error}</p><button className="button button--quiet" type="button" onClick={onRetry}><ArrowClockwise size={16} /> Try again</button></div>}
    {!loading && !error && packages.length === 0 && <div className="app-store__state"><Package size={30} weight="duotone" /><h3>No apps published yet</h3><p>The deployment administrator can add <code>.hiraya.app</code> packages to the store desktop.</p></div>}
    {!loading && !error && packages.length > 0 && <div className="app-store__list" role="list">
      {packages.map((view) => {
        const installed = view.appId ? installedApps.find((app) => app.appId === view.appId) : installedApps.find((app) => app.source === "store" && app.packageEntryId === view.item.entry.id);
        const current = installed?.source === "store" && installed.sourceCatalogId === view.item.catalogId && installed.sourceDesktopId === view.item.desktopId && installed.packageEntryId === view.item.entry.id && installed.sourceContentRevision === view.item.contentRevision;
        const launchApproved = Boolean(installed && (current || view.loading || view.error || offline));
        const retry = Boolean(view.error && !installed);
        const action = launchApproved ? "Open" : retry ? "Retry" : installed ? "Update" : "Install";
        return <article className="app-store__row" role="listitem" key={view.item.entry.id}>
          <span className="app-store__icon"><Package size={25} weight="duotone" /></span>
          <div className="app-store__copy">
            <div><h3>{view.name}</h3>{view.version && <span>v{view.version}</span>}</div>
            <p role={view.error ? "alert" : undefined}>{view.loading ? "Inspecting package..." : view.error || view.description}</p>
            <small>{formatBytes(view.item.entry.size)}{installed && !current ? " · Update available" : current ? " · Installed on this device" : ""}</small>
          </div>
          <button className={`button ${launchApproved || retry ? "button--quiet" : "button--primary"}`} type="button" disabled={!launchApproved && !retry && (view.loading || offline)} onClick={() => launchApproved && installed ? onLaunch(installed) : retry ? onRetry() : onInstall(view.item)}>
            {launchApproved ? <Play size={16} weight="fill" /> : retry ? <ArrowClockwise size={16} /> : <DownloadSimple size={16} />}{action}
          </button>
        </article>;
      })}
    </div>}
  </section>;
}
