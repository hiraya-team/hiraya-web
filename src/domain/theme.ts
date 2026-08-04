import type { CustomTheme as PortableCustomTheme } from "@hiraya-team/apps-contracts/theme";

export type { ThemeColors, ThemeDefinition, ThemeFontFamily, ThemeTexture, ThemeTreatment } from "@hiraya-team/apps-contracts/theme";

export type ThemeWallpaperKind = "static" | "animated" | "scene";
export type ThemeWallpaperPackage = {
  assetId: string;
  kind: ThemeWallpaperKind;
  size: number;
  sha256: string;
  revision: number;
};

export type CustomTheme = PortableCustomTheme & { wallpaper?: ThemeWallpaperPackage };
export type ThemeState = { selectedThemeId: string; customThemes: CustomTheme[] };
