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
