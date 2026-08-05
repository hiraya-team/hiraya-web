import { describe, expect, test } from "bun:test";
import { navigationFallbackDenylist } from "../build/navigation";
import { API_ROUTES } from "../src/lib/api-routes";
import { formatDesktopRoute, parseDesktopRoute, routeTargetsAppEntry } from "../src/lib/routes";

describe("canonical routes", () => {
  test("round-trips desktop areas and rejects hashes", () => {
    const route = { desktopId: "desk one", column: -2, row: 3, fileId: "file #3" };
    expect(formatDesktopRoute(route)).toBe("/desktops/desk%20one/areas/-2/3/file/file%20%233");
    expect(parseDesktopRoute(formatDesktopRoute(route))).toEqual(route);
    expect(parseDesktopRoute("/desktops/desk/areas/not-a-column/0")).toBeNull();
    expect(parseDesktopRoute("#/desktops/desk/areas/0/0")).toBeNull();
  });

  test("constructs only canonical scoped API paths", () => {
    expect(API_ROUTES.desktops).toBe("/api/desktops");
    expect(API_ROUTES.desktopProjection("a/b")).toBe("/api/desktops/a%2Fb?projection=web");
    expect(API_ROUTES.desktopContent("d", "a/b")).toBe("/api/desktops/d/entries/a%2Fb/content");
    expect(API_ROUTES.desktopEntryTransactions("d")).toBe("/api/desktops/d/entries/transactions");
    expect(API_ROUTES.desktopEntryTransactionCommit("d", "transaction/id")).toBe("/api/desktops/d/entries/transactions/transaction%2Fid/commit");
    expect(API_ROUTES.desktopContent("d", "a/b", 7)).toBe("/api/desktops/d/entries/a%2Fb/content?revision=7");
    expect(API_ROUTES.desktopContent("d", "a/b", 7, "preview")).toBe("/api/desktops/d/entries/a%2Fb/content?revision=7&purpose=preview");
    expect(API_ROUTES.events).toBe("/api/events?protocol=entry-transactions-v1");
    expect(API_ROUTES.shortLinks).toBe("/api/short-links");
    expect(API_ROUTES.shortLink("launch/notes")).toBe("/api/short-links/launch%2Fnotes");
  });

  test("leaves server-owned navigations to the server and handles desktop paths", () => {
    const denied = (pathname: string) => navigationFallbackDenylist().some((pattern) => pattern.test(pathname));
    for (const pathname of ["/api/health", "/assets/app.js", "/login", "/login?returnTo=%2Fdesktops%2Fdesk%2Fareas%2F0%2F0", "/register?token=invite", "/profile", "/logout", "/admin/accounts", "/shared/token", "/published/team-desk/roadmap", "/r/launch-notes"]) {
      expect(denied(pathname)).toBeTrue();
    }
    expect(denied("/desktops/desk/areas/0/0/file/note")).toBeFalse();
    expect(denied("/desktops/app-store/areas/0/0")).toBeFalse();
  });

  test("round-trips explorer, properties, settings, and signed area coordinates", () => {
    expect(parseDesktopRoute("/desktops/desk/areas/-7/2/explorer/root/file/read%20me")).toEqual({ desktopId: "desk", column: -7, row: 2, explorerFolderId: null, fileId: "read me" });
    expect(formatDesktopRoute({ desktopId: "desk", column: 0, row: -1, propertiesEntryId: "entry" })).toBe("/desktops/desk/areas/0/-1/properties/entry");
    expect(formatDesktopRoute({ desktopId: "desk", column: 3, row: 4, settings: true })).toBe("/desktops/desk/areas/3/4/settings");
    expect(parseDesktopRoute("/desktops/desk/areas/0/0/file/a/properties/b")).toBeNull();
  });

  test("keeps delayed app launches behind the current route", () => {
    const folderRoute = { desktopId: "desk", column: 0, row: 0, explorerFolderId: "folder" };
    expect(routeTargetsAppEntry(folderRoute, { targetKind: "file", entryId: "file" })).toBeFalse();
    expect(routeTargetsAppEntry(folderRoute, { targetKind: "folder", entryId: "folder" })).toBeTrue();
    expect(routeTargetsAppEntry({ ...folderRoute, explorerFolderId: null }, { targetKind: "root", entryId: null })).toBeTrue();
    expect(routeTargetsAppEntry({ desktopId: "desk", column: 0, row: 0, fileId: "file" }, { targetKind: "file", entryId: "file" })).toBeTrue();
  });
});
