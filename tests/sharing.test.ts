import { describe, expect, test } from "bun:test";
import { confirmDesktopAliasChange, confirmItemAliasChange, isValidPublicationAlias, publishDesktop, publishItem, suggestAlias } from "../src/lib/sharing";

describe("sharing contracts", () => {
  test("suggests valid ASCII aliases without pretending they are authoritative", () => {
    expect(suggestAlias("Quarterly Plan.pdf")).toBe("quarterly-plan-pdf");
    expect(suggestAlias("é")).toBe("e-item");
  });

  test("shares one strict alias contract and rejects invalid mutations before fetch", async () => {
    expect(isValidPublicationAlias("team-desk")).toBe(true);
    for (const alias of ["ab", "-team", "team-", "Team", "team_name", "a".repeat(49)]) expect(isValidPublicationAlias(alias)).toBe(false);
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls += 1; return new Response(); }) as typeof fetch;
    try {
      await expect(publishDesktop("desktop", { alias: "-bad", shareEntire: true })).rejects.toThrow("desktop alias");
      await expect(publishItem("desktop", "entry", { alias: "good-item", desktopAlias: "bad-" })).rejects.toThrow("publication alias");
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("confirms only changes to existing aliases", () => {
    let prompts = 0;
    const cancel = () => { prompts += 1; return false; };
    expect(confirmDesktopAliasChange(undefined, "team-desk", cancel)).toBe(true);
    expect(confirmDesktopAliasChange("team-desk", "team-desk", cancel)).toBe(true);
    expect(confirmDesktopAliasChange("team-desk", "new-desk", cancel)).toBe(false);
    expect(confirmItemAliasChange(undefined, "roadmap", cancel)).toBe(true);
    expect(confirmItemAliasChange("roadmap", "roadmap", cancel)).toBe(true);
    expect(confirmItemAliasChange("roadmap", "new-roadmap", cancel)).toBe(false);
    expect(prompts).toBe(2);
    expect(confirmDesktopAliasChange("team-desk", "new-desk", () => true)).toBe(true);
    expect(confirmItemAliasChange("roadmap", "new-roadmap", () => true)).toBe(true);
  });

  test("keeps publication controls visible to managers and disables them offline", async () => {
    const app = await Bun.file(new URL("../src/Desktop.tsx", import.meta.url)).text();
    const menu = await Bun.file(new URL("../src/components/ContextMenu.tsx", import.meta.url)).text();
    const sharing = await Bun.file(new URL("../src/components/SharingDialog.tsx", import.meta.url)).text();
    const publish = await Bun.file(new URL("../src/components/PublishDialog.tsx", import.meta.url)).text();
    expect(app).toMatch(/contextMenuEntries\.length === 1\s*&&\s*activeDesktop\?\.capabilities\.manage\s*&&\s*publicationsAvailable/);
    expect(app).toContain("publishDisabled={!canManage}");
    expect(app).toMatch(/publishEntryId\s*\|\|\s*confirmation/);
    expect(menu).toContain("Publish...");
    expect(sharing).toContain("Share entire desktop");
    expect(sharing).toContain("publicationUrl && sharing.publication.shareEntire");
    expect(sharing).toContain("Open ${item.name} public link");
    expect(sharing).not.toContain("Rotate");
    expect(sharing).not.toContain("Expires");
    expect(publish).toContain("Files added inside this folder later will become public");
  });
});
