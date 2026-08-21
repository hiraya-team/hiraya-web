import type { ThemeTokens } from "@hiraya-team/apps-contracts";

export type ThemeTarget = {
  dataset: { theme?: string };
  style: Pick<CSSStyleDeclaration, "setProperty">;
};

export interface ApplyThemeOptions {
  target?: ThemeTarget;
}

export interface BindThemeOptions extends ApplyThemeOptions {
  onChange?(theme: ThemeTokens): void;
}

export interface ThemeSource {
  on(event: "theme.changed", listener: (theme: ThemeTokens) => void): () => void;
}

/** Lists theme tokens exposed as CSS custom properties. */
const TOKEN_NAMES = [
  "background",
  "surface",
  "surfaceElevated",
  "text",
  "textMuted",
  "border",
  "accent",
  "accentText",
  "danger",
  "focus",
] as const;

/** Applies Hiraya theme tokens to a target element. */
export function applyThemeTokens(theme: ThemeTokens, options: ApplyThemeOptions = {}): void {
  const target = options.target ?? defaultTarget();
  target.dataset.theme = theme.mode;
  for (const name of TOKEN_NAMES) {
    target.style.setProperty(`--hiraya-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, theme[name]);
  }
}

/** Applies a theme and subscribes the target to later changes. */
export function bindTheme(source: ThemeSource, initialTheme: ThemeTokens, options: BindThemeOptions = {}): () => void {
  const update = (theme: ThemeTokens) => {
    applyThemeTokens(theme, options);
    options.onChange?.(theme);
  };
  update(initialTheme);
  return source.on("theme.changed", update);
}

/** Returns the document root as the default theme target. */
function defaultTarget(): ThemeTarget {
  if (typeof document === "undefined") throw new Error("applyThemeTokens requires a target outside the browser.");
  return document.documentElement;
}
