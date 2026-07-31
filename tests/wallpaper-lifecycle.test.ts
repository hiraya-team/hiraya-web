import { describe, expect, test } from "bun:test";

describe("custom wallpaper lifecycle", () => {
  test("keeps packaged wallpapers mounted across visibility changes", async () => {
    const source = await Bun.file(new URL("../src/components/ThemeWallpaper.tsx", import.meta.url)).text();

    expect(source).not.toContain("visibilitychange");
    expect(source).not.toContain("document.visibilityState");
    expect(source).toContain("data-wallpaper-pending");
  });

  test("distinguishes pending custom wallpapers from failed fallbacks", async () => {
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

    expect(css).toContain('[data-wallpaper="file"]:not([data-custom-loaded]):not([data-custom-failed])');
    expect(css).toContain('[data-wallpaper="theme"]:has(.wallpaper-image[data-wallpaper-pending])');
  });
});
