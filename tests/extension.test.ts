import { expect, test } from "bun:test";

test("packages a permission-free Manifest V3 new-tab redirect with every referenced asset", async () => {
  const root = new URL("../extension/", import.meta.url);
  const manifest = await Bun.file(new URL("manifest.json", root)).json() as {
    manifest_version: number;
    permissions?: string[];
    icons: Record<string, string>;
    chrome_url_overrides: { newtab: string };
  };
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toBeUndefined();
  expect(manifest.chrome_url_overrides).toEqual({ newtab: "newtab.html" });
  for (const path of [...Object.values(manifest.icons), manifest.chrome_url_overrides.newtab]) {
    expect(await Bun.file(new URL(path, root)).exists(), path).toBe(true);
  }
  const newTab = await Bun.file(new URL(manifest.chrome_url_overrides.newtab, root)).text();
  expect(newTab).toContain('<meta http-equiv="refresh" content="0; url=https://hiraya.sh/" />');
  expect(newTab).toContain('<meta name="referrer" content="no-referrer" />');
  expect(newTab).toContain('<a href="https://hiraya.sh/">Hiraya</a>');
});
