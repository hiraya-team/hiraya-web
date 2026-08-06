import { useEffect, useMemo, useRef, useState } from "react";
import type { AppInstanceOwner } from "../../apps/host";
import { AppHostServices, AppLifecycleService, AppPersistentStorageService, AppThemeService, CapabilityStore, type AppNotification, type DialogRequest } from "../../apps/host";
import { parseFileAssociation, type FileAssociation, type InstalledApp, type QuarantinedApp } from "../../apps/installed-apps";
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
import type { AppPackageInspection } from "@hiraya-team/apps-contracts";
import { AccountAppsClient, type AccountAppsClientState } from "./account-sync";
import type { AccountApp } from "../../lib/account-apps";

type AppPlatformOptions = {
  enabled: boolean;
  initialTheme: ThemeDefinition;
  onCloseRequest: (owner: AppInstanceOwner) => boolean | void | Promise<boolean | void>;
  onError: (error: Error) => void;
  accountSyncOrigin: string | null;
};

export function useAppPlatform({ enabled, initialTheme, onCloseRequest, onError, accountSyncOrigin }: AppPlatformOptions) {
  const closeRequestRef = useRef(onCloseRequest);
  closeRequestRef.current = onCloseRequest;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const initialThemeRef = useRef(initialTheme);

  const lifecycle = useMemo(() => new AppLifecycleService(2_000, (owner) => closeRequestRef.current(owner)), []);
  const theme = useMemo(() => new AppThemeService(initialThemeRef.current), []);
  const accountClient = useMemo(() => accountSyncOrigin ? new AccountAppsClient(accountSyncOrigin) : null, [accountSyncOrigin]);
  const hostServices = useMemo(() => new AppHostServices(lifecycle, theme, new AppPersistentStorageService(accountClient ? {
    get: (appId, key) => accountClient.owns(appId) ? accountClient.getData(appId, key) : readAppStorage(appId, key),
    set: (appId, key, value, maxBytes, maxEntries) => accountClient.owns(appId) ? accountClient.setData(appId, key, value).then(() => undefined) : writeAppStorage(appId, key, value, maxBytes, maxEntries),
    remove: (appId, key) => accountClient.owns(appId) ? accountClient.removeData(appId, key).then(() => undefined) : removeAppStorage(appId, key),
    clear: (appId) => accountClient.owns(appId) ? accountClient.clearData(appId).then(() => undefined) : clearAppStorage(appId),
  } : { get: readAppStorage, set: writeAppStorage, remove: removeAppStorage, clear: clearAppStorage })), [accountClient, lifecycle, theme]);
  const capabilities = useMemo(() => new CapabilityStore(), []);
  const [localApps, setLocalApps] = useState<InstalledApp[]>([]);
  const [accountState, setAccountState] = useState<AccountAppsClientState | null>(null);
  const [appsLoaded, setAppsLoaded] = useState(false);
  const [localFileAssociations, setLocalFileAssociations] = useState<FileAssociation[]>([]);
  const [quarantinedApps, setQuarantinedApps] = useState<QuarantinedApp[]>([]);
  const [dialogRequests, setDialogRequests] = useState<readonly DialogRequest[]>([]);
  const [notifications, setNotifications] = useState<readonly AppNotification[]>([]);

  useEffect(() => hostServices.dialogs.subscribe(setDialogRequests), [hostServices]);
  useEffect(() => hostServices.notifications.subscribe(setNotifications), [hostServices]);

  useEffect(() => {
    if (!enabled || !accountClient) { setAccountState(null); return; }
    let active = true;
    void accountClient.start((value) => { if (active) setAccountState(value); }).catch((error) => errorRef.current(error instanceof Error ? error : new Error("Account apps could not be loaded.")));
    return () => { active = false; accountClient.stop(); };
  }, [accountClient, enabled]);

  const installedApps = useMemo(() => localApps.filter((approval) => {
    if (approval.source !== "account") return true;
    const desired = accountState?.state.projection.apps.find((app) => app.appId === approval.appId);
    return Boolean(desired && approval.installationGeneration === desired.installationGeneration && approval.digest === desired.digest && approval.manifest.permissions.length === desired.manifest.permissions.length && approval.manifest.permissions.every((permission, index) => permission === desired.manifest.permissions[index]));
  }), [accountState, localApps]);
  const fileAssociations = useMemo(() => {
    if (!accountClient || !accountState) return localFileAssociations;
    const remote = Object.entries(accountState.state.projection.handlerHints).flatMap(([matcher, appId]) => {
      try { return [parseFileAssociation({ matcher, appId, createdAt: 0 })]; } catch { return []; }
    });
    const remoteMatchers = new Set(remote.map((association) => association.matcher));
    const accountAppIds = new Set(accountState.state.baseline?.apps.map((app) => app.appId) ?? []);
    return [...localFileAssociations.filter((association) => !remoteMatchers.has(association.matcher) && !accountAppIds.has(association.appId)), ...remote].sort((left, right) => left.matcher.localeCompare(right.matcher));
  }, [accountClient, accountState, localFileAssociations]);
  const availableAccountApps = useMemo(() => accountState?.state.baseline?.apps.filter((app) => !installedApps.some((approval) => approval.appId === app.appId)) ?? [], [accountState, installedApps]);

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
        setLocalApps([...storedApps.filter((app) => app.source !== "system" && !systemIds.has(app.appId)), ...retainedSystemApps.filter((app) => !systemIds.has(app.appId)), ...systemApps]);
        setLocalFileAssociations(associations);
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
    setLocalApps((current) => [...current.filter((item) => item.appId !== install.appId), install]);
  }

  async function removeInstall(appId: string) {
    await uninstallApp(appId);
    setLocalApps((current) => current.filter((item) => item.appId !== appId));
    setLocalFileAssociations((current) => current.filter((association) => association.appId !== appId));
  }

  async function discardQuarantine(appId: string) {
    await removeQuarantinedApp(appId);
    setQuarantinedApps((current) => current.filter((item) => item.appId !== appId));
  }

  async function saveAssociation(matcher: string, appId: string) {
    const association = await setFileAssociation({ matcher, appId, createdAt: Date.now() });
    const next = [...fileAssociations.filter((item) => item.matcher !== association.matcher), association].sort((left, right) => left.matcher.localeCompare(right.matcher));
    setLocalFileAssociations(next);
    if (accountClient) {
      const hints = { ...(accountState?.state.projection.handlerHints ?? {}) };
      if (accountClient.owns(appId)) {
        hints[association.matcher] = association.appId;
        await accountClient.setHandlers(hints);
      } else if (association.matcher in hints) {
        delete hints[association.matcher];
        await accountClient.setHandlers(hints);
      }
    }
    return association;
  }

  async function deleteAssociation(matcher: string) {
    await removeFileAssociation(matcher);
    const next = fileAssociations.filter((item) => item.matcher !== matcher);
    setLocalFileAssociations(next);
    if (accountClient) {
      const hints = { ...(accountState?.state.projection.handlerHints ?? {}) };
      if (matcher in hints) {
        delete hints[matcher];
        await accountClient.setHandlers(hints);
      }
    }
  }

  async function clearAssociations() {
    await resetFileAssociations();
    setLocalFileAssociations([]);
    if (accountClient && Object.keys(accountState?.state.projection.handlerHints ?? {}).length) await accountClient.setHandlers({});
  }

  async function publishAccountInstall(archive: Blob, inspection: AppPackageInspection) {
    if (!accountClient) throw new Error("Account app synchronization is unavailable.");
    const app = await accountClient.install(archive, inspection);
    if (!app) return null;
    const approval: InstalledApp = { appId: app.appId, source: "account", packageEntryId: null, archivePath: null, installationGeneration: app.generations.installationGeneration, digest: app.package.sha256, version: app.manifest.version, manifest: app.manifest, approvedAt: Date.now() };
    await approveInstall(approval);
    return approval;
  }

  async function approveAccountInstall(app: AccountApp) {
    if (!accountClient) throw new Error("Account app synchronization is unavailable.");
    const approval = await accountClient.approve(app);
    await approveInstall(approval);
    return approval;
  }

  return {
    lifecycle,
    theme,
    hostServices,
    capabilities,
    installedApps,
    availableAccountApps,
    accountAppsSnapshot: accountState?.state.baseline ?? null,
    accountAppsError: accountState?.error ?? "",
    accountAppsPending: accountState?.outbox.filter((record) => record.status === "pending").length ?? 0,
    blockedAccountAppOperations: accountState?.outbox.filter((record) => record.status === "blocked") ?? [],
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
    clearAppData: (appId: string) => accountClient?.owns(appId) ? accountClient.clearData(appId).then(() => undefined) : clearAppStorage(appId),
    publishAccountInstall,
    approveAccountInstall,
    uninstallAccountApp: accountClient?.uninstall.bind(accountClient),
    retryAccountAppOperation: accountClient?.retry.bind(accountClient),
    discardAccountAppOperation: accountClient?.discard.bind(accountClient),
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
