import type { DesktopCapabilities, DesktopIdentity } from "../types";

export const OWNER_CAPABILITIES: DesktopCapabilities = {
  read: true,
  write: true,
  manage: true,
  delete: true,
  settings: true,
  activity: true,
};

export const READ_ONLY_CAPABILITIES: DesktopCapabilities = {
  read: true,
  write: false,
  manage: false,
  delete: false,
  settings: false,
  activity: false,
};

export function localDesktopIdentity(id: string, name: string): DesktopIdentity {
  return {
    id,
    name,
    pinned: false,
    ownership: "owned",
    role: "owner",
    owner: { id: "local", displayName: "You", avatar: null },
    capabilities: { ...OWNER_CAPABILITIES },
    authorityCatalogId: null,
  };
}

export function canMutateDesktop(desktop: DesktopIdentity | undefined, status: string) {
  if (!desktop?.capabilities.write || status === "connecting" || status === "upgrade-required" || status === "error") return false;
  return desktop.ownership === "owned" || status === "online" || status === "offline" || status === "blocked" || status === "local";
}

export function canViewDesktopActivity(desktop: DesktopIdentity | undefined, status: string) {
  return Boolean(desktop?.capabilities.activity && (status === "online" || status === "local"));
}

export function fileWriteCapability(desktop: DesktopIdentity | undefined, status: string) {
  if (!desktop?.capabilities.write) return { write: false, writeReason: "read-only" as const };
  if (!canMutateDesktop(desktop, status)) return { write: false, writeReason: "temporarily-unavailable" as const };
  return { write: true, writeReason: "available" as const };
}

export function settingsRestrictionReason(desktop: DesktopIdentity | undefined, status: string) {
  if (!desktop) return "Desktop settings are unavailable while this desktop loads.";
  if (!desktop.capabilities.settings) return "Your role can view this desktop's appearance, but cannot change shared settings.";
  if (status === "connecting") return "Connecting to check whether shared settings changed.";
  if (status === "blocked") return "Changes unrelated to the blocked sync item remain available.";
  return "Desktop settings are read-only right now.";
}
