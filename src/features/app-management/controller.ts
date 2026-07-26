import { useEffect, useMemo, useRef, useState } from "react";
import type { AppInstanceOwner } from "../../apps/host";
import { AppHostServices, AppLifecycleService, AppPersistentStorageService, AppThemeService, CapabilityStore, type AppNotification, type DialogRequest } from "../../apps/host";
import type { FileAssociation, InstalledApp, QuarantinedApp } from "../../apps/installed-apps";
import { SYSTEM_APP_CATALOG, systemAppArchiveUrl } from "../../apps/system-apps";
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
  const [fileAssociations, setFileAssociations] = useState<FileAssociation[]>([]);
  const [quarantinedApps, setQuarantinedApps] = useState<QuarantinedApp[]>([]);
  const [dialogRequests, setDialogRequests] = useState<readonly DialogRequest[]>([]);
  const [notifications, setNotifications] = useState<readonly AppNotification[]>([]);

  useEffect(() => hostServices.dialogs.subscribe(setDialogRequests), [hostServices]);
  useEffect(() => hostServices.notifications.subscribe(setNotifications), [hostServices]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void Promise.all([listInstalledApps(), listFileAssociations(), listQuarantinedApps()])
      .then(async ([storedApps, associations, quarantined]) => {
        const byId = new Map(storedApps.map((app) => [app.appId, app]));
        const systemApps = await Promise.all(
          SYSTEM_APP_CATALOG.map(async (item): Promise<InstalledApp> => {
            const response = await fetch(systemAppArchiveUrl(item));
            if (!response.ok) throw new Error(`Could not load bundled ${item.manifest.name}.`);
            const { inspectAppArchive } = await import("@hiraya/app-cli");
            const inspected = await inspectAppArchive(new Uint8Array(await response.arrayBuffer()));
            if (inspected.manifest.id !== item.manifest.id) throw new Error(`Bundled ${item.manifest.name} has the wrong identity.`);
            const current = byId.get(item.manifest.id);
            const install: InstalledApp = { appId: inspected.manifest.id, source: "system", packageEntryId: null, archivePath: item.archivePath, digest: inspected.digest, version: inspected.manifest.version, manifest: inspected.manifest, approvedAt: current?.approvedAt ?? Date.now() };
            await installApp(install);
            return install;
          }),
        );
        if (cancelled) return;
        const systemIds = new Set(systemApps.map((app) => app.appId));
        setInstalledApps([...storedApps.filter((app) => app.source === "desktop" && !systemIds.has(app.appId)), ...systemApps]);
        setFileAssociations(associations);
        setQuarantinedApps(quarantined);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Installed apps could not be loaded.", error);
        errorRef.current(error instanceof Error ? error : new Error("Installed apps could not be loaded."));
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
