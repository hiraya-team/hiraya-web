import { describe, expect, test } from "bun:test";

describe("Scene desktop integration", () => {
  test("uses the shared interactive frame for authenticated and whole public desktops", async () => {
    const [desktop, published] = await Promise.all([
      Bun.file(new URL("../src/App.tsx", import.meta.url)).text(),
      Bun.file(new URL("../src/PublicDesktop.tsx", import.meta.url)).text(),
    ]);
    expect(desktop).toContain('mode="widget"');
    expect(desktop).toContain('mode="wallpaper"');
    expect(published).toContain('wholeDesktop && wallpaperFile && isSceneFile(wallpaperFile)');
    expect(published).toContain('mode="widget"');
    expect(published).toContain('mode="wallpaper"');
  });

  test("lets desktop overlays intercept input while empty wallpaper space reaches the Scene", async () => {
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();
    expect(css).toContain('.scene-wallpaper-layer { position: absolute; z-index: 0;');
    expect(css).toContain('.desktop[data-wallpaper="scene"] .desktop-area-stage--icons { pointer-events: none; }');
    expect(css).toContain('.desktop[data-wallpaper="scene"] .desktop-area-stage--icons .file-icon { pointer-events: auto; }');
    expect(css).toContain('.desktop-area-stage--windows { z-index: 16; pointer-events: none; }');
  });
});
