import { describe, expect, test } from "bun:test";
import type { ThemeTokens } from "@hiraya/apps-contracts";
import { applyThemeTokens, bindTheme, type ThemeTarget } from "./index";

const darkTheme: ThemeTokens = {
  mode: "dark",
  background: "#101a17",
  surface: "#172722",
  surfaceElevated: "#20352d",
  text: "#f4eee0",
  textMuted: "#aabbb4",
  border: "#40584f",
  accent: "#e2aa52",
  accentText: "#172018",
  danger: "#ff8175",
  focus: "#f7c66b",
};

function fakeTarget(): { target: ThemeTarget; properties: Map<string, string> } {
  const properties = new Map<string, string>();
  return {
    target: { dataset: {}, style: { setProperty: (name, value) => { properties.set(name, value); } } },
    properties,
  };
}

describe("sandbox app themes", () => {
  test("maps theme tokens to the shared data attribute and CSS variables", () => {
    const { target, properties } = fakeTarget();
    applyThemeTokens(darkTheme, { target });

    expect(target.dataset.theme).toBe("dark");
    expect(properties).toEqual(new Map([
      ["--hiraya-background", "#101a17"],
      ["--hiraya-surface", "#172722"],
      ["--hiraya-surface-elevated", "#20352d"],
      ["--hiraya-text", "#f4eee0"],
      ["--hiraya-text-muted", "#aabbb4"],
      ["--hiraya-border", "#40584f"],
      ["--hiraya-accent", "#e2aa52"],
      ["--hiraya-accent-text", "#172018"],
      ["--hiraya-danger", "#ff8175"],
      ["--hiraya-focus", "#f7c66b"],
    ]));
  });

  test("applies the initial theme, follows updates, and exposes cleanup", () => {
    const { target, properties } = fakeTarget();
    let listener: ((theme: ThemeTokens) => void) | undefined;
    let unsubscribed = false;
    const seen: ThemeTokens[] = [];
    const source = {
      on: (event: "theme.changed", next: (theme: ThemeTokens) => void) => {
        expect(event).toBe("theme.changed");
        listener = next;
        return () => { unsubscribed = true; };
      },
    };

    const unsubscribe = bindTheme(source, darkTheme, { target, onChange: (theme) => seen.push(theme) });
    const lightTheme = { ...darkTheme, mode: "light", background: "#faf7ef" } as const;
    listener?.(lightTheme);
    unsubscribe();

    expect(target.dataset.theme).toBe("light");
    expect(properties.get("--hiraya-background")).toBe("#faf7ef");
    expect(seen).toEqual([darkTheme, lightTheme]);
    expect(unsubscribed).toBe(true);
  });
});
