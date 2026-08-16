export type ExplorerView = "list" | "grid";

export type DesktopPreference = { id: string; pinned: boolean };

export type LocalPreferences = {
  autoUpdate: boolean;
  externalEmbeddedPreviews: boolean;
  allowBrowserPinchZoom: boolean;
  searchAllDesktops: boolean;
  onboardingVersion: number;
  showDesktopMinimap: boolean;
  explorerView: ExplorerView;
  showHiddenFiles: boolean;
  desktops: DesktopPreference[];
};

export type DevicePreferences = Omit<LocalPreferences, "showDesktopMinimap" | "desktops">;

export const DEFAULT_DEVICE_PREFERENCES: DevicePreferences = {
  autoUpdate: true,
  externalEmbeddedPreviews: false,
  allowBrowserPinchZoom: false,
  searchAllDesktops: false,
  onboardingVersion: 0,
  explorerView: "list",
  showHiddenFiles: false,
};

export function parseDevicePreferences(value: unknown): DevicePreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Device preferences have an unsupported format.");
  const item = value as Record<string, unknown>;
  const keys = ["allowBrowserPinchZoom", "autoUpdate", "explorerView", "externalEmbeddedPreviews", "onboardingVersion", "searchAllDesktops", "showHiddenFiles"];
  if (Object.keys(item).sort().join("\0") !== keys.join("\0")
    || [item.autoUpdate, item.externalEmbeddedPreviews, item.allowBrowserPinchZoom, item.searchAllDesktops, item.showHiddenFiles].some((field) => typeof field !== "boolean")
    || !Number.isSafeInteger(item.onboardingVersion) || (item.onboardingVersion as number) < 0
    || item.explorerView !== "list" && item.explorerView !== "grid") throw new Error("Device preferences have an unsupported format.");
  return item as DevicePreferences;
}
