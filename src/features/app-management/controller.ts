import { useEffect, useMemo, useRef, useState } from "react";
import type { AppInstanceOwner } from "../../apps/host";
import { AppHostServices, AppLifecycleService, AppPersistentStorageService, AppThemeService, CapabilityStore, type AppNotification, type DialogRequest } from "../../apps/host";
import type { FileAssociation, InstalledApp, QuarantinedApp } from "../../apps/installed-apps";
import { SYSTEM_APP_CATALOG, type SystemAppCatalogItem } from "../../apps/system-apps";
import type { ThemeDefinition } from "../../domain/theme";
import {
  clearAppStorage,
  installApp,
  listFileAssociations,
  listInstalledApps,
  listQuarantinedApps,
  readAppStorage,
  removeAppStorage,
  removeFileAssociation,
  removeQuarantinedApp,
  resetFileAssociations,
  setFileAssociation,
  uninstallApp,
  writeAppStorage,
} from "../../platform/storage/repositories";
import { readApprovedPackageArchive } from "../../platform/storage/blobs";

type AppPlatformOptions = {
  enabled: boolean;
  initialTheme: ThemeDefinition;
  onCloseRequest: (owner: AppInstanceOwner) => boolean | void | Promise<boolean | void>;
  onError: (error: Error) => void;
};

export function useAppPlatform({ enabled, initialTheme, onCloseRequest, onError }: AppPlatformOptions) {
  const closeRequestRef = useRef(onCloseRequest);
  closeRequestRef.current = onCloseRequest;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const initialThemeRef = useRef(initialTheme);

  const lifecycle = useMemo(() => new AppLifecycleService(2_000, (owner) => closeRequestRef.current(owner)), []);
  const theme = useMemo(() => new AppThemeService(initialThemeRef.current), []);
  const hostServices = useMemo(() => new AppHostServices(lifecycle, theme, new AppPersistentStorageService({ get: readAppStorage, set: writeAppStorage, remove: removeAppStorage, clear: clearAppStorage })), [lifecycle, theme]);
  const capabilities = useMemo(() => new CapabilityStore(), []);
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [appsLoaded, setAppsLoaded] = useState(false);
  const [fileAssociations, setFileAssociations] = useState<FileAssociation[]>([]);
  const [quarantinedApps, setQuarantinedApps] = useState<QuarantinedApp[]>([]);
  const [dialogRequests, setDialogRequests] = useState<readonly DialogRequest[]>([]);
  const [notifications, setNotifications] = useState<readonly AppNotification[]>([]);

  useEffect(() => hostServices.dialogs.subscribe(setDialogRequests), [hostServices]);
  useEffect(() => hostServices.notifications.subscribe(setNotifications), [hostServices]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setAppsLoaded(false);
    void Promise.all([listInstalledApps(), listFileAssociations(), listQuarantinedApps()])
      .then(async ([storedApps, associations, quarantined]) => {
        const retainedSystemApps = (await Promise.all(storedApps.filter((app) => app.source === "system").map(async (app) => {
          try { await readApprovedPackageArchive(app.digest); return app; } catch { return null; }
        }))).filter((app): app is InstalledApp & { source: "system" } => app !== null);
        const byId = new Map([...storedApps.filter((app) => app.source !== "system"), ...retainedSystemApps].map((app) => [app.appId, app]));
        const systemApps = await Promise.all(SYSTEM_APP_CATALOG.map(async (item) => {
          const current = byId.get(item.manifest.id);
          if (current?.source === "system") return current;
          const install = systemInstallFromCatalog(item, current);
          if (!current || !systemInstallMatchesCatalog(current, item)) await installApp(install);
          return install;
        }));
        if (cancelled) return;
        const systemIds = new Set(systemApps.map((app) => app.appId));
        setInstalledApps([...storedApps.filter((app) => app.source !== "system" && !systemIds.has(app.appId)), ...retainedSystemApps.filter((app) => !systemIds.has(app.appId)), ...systemApps]);
        setFileAssociations(associations);
        setQuarantinedApps(quarantined);
        setAppsLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Installed apps could not be loaded.", error);
        errorRef.current(error instanceof Error ? error : new Error("Installed apps could not be loaded."));
        setAppsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  async function approveInstall(install: InstalledApp) {
    await installApp(install);
    setInstalledApps((current) => [...current.filter((item) => item.appId !== install.appId), install]);
  }

  async function removeInstall(appId: string) {
    await uninstallApp(appId);
    setInstalledApps((current) => current.filter((item) => item.appId !== appId));
    setFileAssociations((current) => current.filter((association) => association.appId !== appId));
  }

  async function discardQuarantine(appId: string) {
    await removeQuarantinedApp(appId);
    setQuarantinedApps((current) => current.filter((item) => item.appId !== appId));
  }

  async function saveAssociation(matcher: string, appId: string) {
    const association = await setFileAssociation({ matcher, appId, createdAt: Date.now() });
    setFileAssociations((current) => [...current.filter((item) => item.matcher !== association.matcher), association].sort((left, right) => left.matcher.localeCompare(right.matcher)));
    return association;
  }

  async function deleteAssociation(matcher: string) {
    await removeFileAssociation(matcher);
    setFileAssociations((current) => current.filter((item) => item.matcher !== matcher));
  }

  async function clearAssociations() {
    await resetFileAssociations();
    setFileAssociations([]);
  }

  return {
    lifecycle,
    theme,
    hostServices,
    capabilities,
    installedApps,
    appsLoaded,
    fileAssociations,
    quarantinedApps,
    dialogRequests,
    notifications,
    approveInstall,
    removeInstall,
    discardQuarantine,
    saveAssociation,
    deleteAssociation,
    clearAssociations,
    clearAppData: clearAppStorage,
  };
}

export function systemInstallMatchesCatalog(install: InstalledApp, item: SystemAppCatalogItem): boolean {
  return install.source === "system"
    && install.appId === item.manifest.id
    && install.archivePath === item.archivePath
    && install.digest === item.digest
    && install.version === item.manifest.version;
}

export function systemInstallFromCatalog(item: SystemAppCatalogItem, current?: InstalledApp): InstalledApp {
  return {
    appId: item.manifest.id,
    source: "system",
    packageEntryId: null,
    archivePath: item.archivePath,
    digest: item.digest,
    version: item.manifest.version,
    manifest: item.manifest,
    approvedAt: current?.approvedAt ?? Date.now(),
  };
}
