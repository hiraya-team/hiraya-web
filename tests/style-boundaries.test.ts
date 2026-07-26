import { describe, expect, test } from "bun:test";

describe("style ownership", () => {
  test("loads foundation before the order-sensitive desktop cascade", async () => {
    const entry = await Bun.file(new URL("../src/styles/index.css", import.meta.url)).text();
    const foundationIndex = entry.indexOf('@import "./foundation.css";');
    const desktopIndex = entry.indexOf('@import "../styles.css";');

    expect(foundationIndex).toBeGreaterThanOrEqual(0);
    expect(desktopIndex).toBeGreaterThan(foundationIndex);
  });

  test("keeps document reset ownership out of feature styles", async () => {
    const foundation = await Bun.file(new URL("../src/styles/foundation.css", import.meta.url)).text();
    const desktop = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();

    expect(foundation).toContain(":root {");
    expect(foundation).toContain("html,\nbody,\n#root {");
    expect(desktop).not.toContain(":root {");
  });
});
