export type ThemeFontFamily = "humanist" | "system" | "mono";

export type ThemeColors = {
  shell: string;
  chrome: string;
  chromeText: string;
  window: string;
  windowMuted: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  border: string;
  danger: string;
  dangerSurface: string;
  desktopText: string;
  selection: string;
  editorBackground: string;
  editorText: string;
  editorGutter: string;
  editorKeyword: string;
  editorString: string;
  editorComment: string;
};

export type ThemeDefinition = {
  colors: ThemeColors;
  shape: { radius: number; borderWidth: number };
  effects: { blur: number; opacity: number; shadow: number };
  typography: { family: ThemeFontFamily; scale: number; weight: number };
  density: number;
  motion: number;
  iconSize: number;
};

export type ThemeWallpaperKind = "static" | "animated" | "scene";
export type ThemeWallpaperPackage = {
  assetId: string;
  kind: ThemeWallpaperKind;
  size: number;
  sha256: string;
  revision: number;
};

export type CustomTheme = { id: string; name: string; definition: ThemeDefinition; wallpaper?: ThemeWallpaperPackage };
export type ThemeState = { selectedThemeId: string; customThemes: CustomTheme[] };
