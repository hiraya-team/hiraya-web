export type ExplorerView = "list" | "grid";

export type LocalPreferences = {
  autoUpdate: boolean;
  externalEmbeddedPreviews: boolean;
  allowBrowserPinchZoom: boolean;
  searchAllDesktops: boolean;
  onboardingVersion: number;
  showDesktopMinimap: boolean;
  explorerView: ExplorerView;
  showHiddenFiles: boolean;
};
