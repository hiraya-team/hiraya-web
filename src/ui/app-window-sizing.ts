import type { AppManifestWindow } from "@hiraya-team/apps-contracts";
import type { ThemeDefinition } from "../domain/theme";

export function sandboxWindowOptions(window: AppManifestWindow, theme: ThemeDefinition) {
  if ("width" in window) return window;
  const borders = theme.shape.borderWidth * 2;
  return { width: window.renderWidth + borders, height: window.renderHeight + 46 * theme.density + borders + theme.shape.borderWidth, minWidth: window.minWidth, minHeight: window.minHeight };
}
