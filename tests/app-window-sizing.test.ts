import { describe, expect, test } from "bun:test";
import { sandboxWindowOptions } from "../src/ui/app-window-sizing";
import { BUILTIN_THEMES } from "../src/lib/themes";
import { initialWindowBounds } from "../src/ui/window-manager";

describe("sandbox app window sizing", () => {
  test("adds active theme chrome around a requested render area", () => {
    const window = { renderWidth: 818, renderHeight: 572, minWidth: 360, minHeight: 260 };

    expect(sandboxWindowOptions(window, BUILTIN_THEMES["hiraya-dusk"].definition)).toEqual({ width: 820, height: 621, minWidth: 360, minHeight: 260 });
    const highContrast = sandboxWindowOptions(window, BUILTIN_THEMES["high-contrast"].definition);
    expect(highContrast).toMatchObject({ width: 822, minWidth: 360, minHeight: 260 });
    expect(highContrast.height).toBeCloseTo(627.68);
  });

  test("preserves legacy outer sizes and desktop clamping", () => {
    const legacy = { width: 900, height: 700, minWidth: 400, minHeight: 300 };

    expect(sandboxWindowOptions(legacy, BUILTIN_THEMES["hiraya-dusk"].definition)).toBe(legacy);
    expect(initialWindowBounds({ width: 500, height: 400 }, sandboxWindowOptions({ renderWidth: 818, renderHeight: 572, minWidth: 360, minHeight: 260 }, BUILTIN_THEMES["hiraya-dusk"].definition))).toEqual({ x: 0, y: 0, width: 500, height: 400 });
  });
});
