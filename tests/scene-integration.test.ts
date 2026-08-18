import { describe, expect, test } from "bun:test";

describe("Scene desktop integration", () => {
  test("uses the shared interactive frame for authenticated and whole public desktops", async () => {
    const [desktop, published] = await Promise.all([
      Bun.file(new URL("../src/Desktop.tsx", import.meta.url)).text(),
      Bun.file(new URL("../src/PublicDesktop.tsx", import.meta.url)).text(),
    ]);
    expect(desktop).toContain('mode="widget"');
    expect(desktop).toContain('mode="wallpaper"');
    expect(published).toContain('wholeDesktop && wallpaperFile && isSceneFile(wallpaperFile)');
    expect(published).toContain('mode="widget"');
    expect(published).toContain('mode="wallpaper"');
  });

  test("keeps the shell as pointer owner while wallpaper Scenes observe its events", async () => {
    const [css, desktop, published] = await Promise.all([
      Bun.file(new URL("../src/styles.css", import.meta.url)).text(),
      Bun.file(new URL("../src/Desktop.tsx", import.meta.url)).text(),
      Bun.file(new URL("../src/PublicDesktop.tsx", import.meta.url)).text(),
    ]);
    expect(css).toContain('.scene-wallpaper-layer { position: absolute; z-index: 0; inset: 0; overflow: hidden; pointer-events: none; }');
    expect(css).toContain('.scene-frame--wallpaper { display: block; pointer-events: none; }');
    expect(css).not.toContain('.desktop[data-wallpaper="scene"] .desktop-area-stage--icons { pointer-events: none; }');
    expect(desktop).toContain("onContextMenuCapture={observeDesktopContextMenu}");
    expect(published).toContain("onContextMenuCapture={observeContextMenu}");
  });
});
