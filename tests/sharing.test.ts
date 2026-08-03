import { describe, expect, test } from "bun:test";
import { confirmDesktopAliasChange, confirmItemAliasChange, isValidPublicationAlias, parseSharingState, publishDesktop, publishItem, suggestAlias } from "../src/lib/sharing";

describe("sharing contracts", () => {
  test("accepts permanent invitations and alias publications", () => {
    const state = parseSharingState({
      members: [{ id: "owner", displayName: "Owner", role: "owner", avatar: null }],
      pendingInvitations: [{ email: "reader@example.test", role: "reader", token: "invite-token", url: "/invite/invite-token" }],
      publication: { configured: true, baseUrl: "https://go.hiraya.sh", desktopAlias: "team-desk", shareEntire: false, items: [{ entryId: "file", alias: "roadmap", name: "Roadmap", kind: "file", url: "https://go.hiraya.sh/team-desk/roadmap" }] },
      audience: { kind: "authenticated-users", role: "reader" },
    });
    expect(state.members[0]).toMatchObject({ userId: "owner", role: "owner" });
    expect(state.pending[0]).toMatchObject({ token: "invite-token", role: "reader" });
    expect(state.publication).toMatchObject({ configured: true, desktopAlias: "team-desk", shareEntire: false, items: [{ entryId: "file", alias: "roadmap" }] });
    expect(state.audience).toEqual({ kind: "authenticated-users", role: "reader" });
  });

  test("rejects owner roles for invitations", () => {
    expect(() => parseSharingState({ members: [], pending: [{ email: "x@example.test", role: "owner" }], publication: {} })).toThrow("invalid role");
  });

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

  test("keeps publication controls scoped to online managers", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const menu = await Bun.file(new URL("../src/components/ContextMenu.tsx", import.meta.url)).text();
    const sharing = await Bun.file(new URL("../src/components/SharingDialog.tsx", import.meta.url)).text();
    const publish = await Bun.file(new URL("../src/components/PublishDialog.tsx", import.meta.url)).text();
    expect(app).toMatch(/contextMenuEntries\.length === 1\s*&&\s*canManage\s*&&\s*publicationsAvailable/);
    expect(app).toMatch(/sharingOpen\s*\|\|\s*publishEntryId\s*\|\|\s*confirmation/);
    expect(menu).toContain("Publish...");
    expect(sharing).toContain("Share entire desktop");
    expect(sharing).toContain("publicationUrl && sharing.publication.shareEntire");
    expect(sharing).toContain("Open ${item.name} public link");
    expect(sharing).not.toContain("Rotate");
    expect(sharing).not.toContain("Expires");
    expect(publish).toContain("Files added inside this folder later will become public");
  });
});
