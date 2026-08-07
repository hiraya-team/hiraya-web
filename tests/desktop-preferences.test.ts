import { describe, expect, test } from "bun:test";
import { arrangeDesktops, moveDesktopPreference, pinDesktopPreference } from "../src/lib/desktop-preferences";
import { remoteDesktopIdentity } from "./fixtures";

describe("desktop preferences", () => {
  test("orders pinned and unpinned desktops without crossing tiers", () => {
    const desktops = [remoteDesktopIdentity("one", "One"), remoteDesktopIdentity("two", "Two"), remoteDesktopIdentity("three", "Three")];
    const preferences = [{ id: "three", pinned: true }, { id: "one", pinned: false }, { id: "two", pinned: false }];
    expect(arrangeDesktops(desktops, preferences).map(({ id, pinned }) => [id, pinned])).toEqual([["three", true], ["one", false], ["two", false]]);
    expect(moveDesktopPreference(preferences, "three", 1)).toEqual(preferences);
    expect(moveDesktopPreference(preferences, "two", -1).map(({ id }) => id)).toEqual(["three", "two", "one"]);
  });

  test("moves a newly pinned desktop to the pinned tier", () => {
    const preferences = [{ id: "one", pinned: true }, { id: "two", pinned: false }, { id: "three", pinned: false }];
    expect(pinDesktopPreference(preferences, "three", true)).toEqual([{ id: "one", pinned: true }, { id: "three", pinned: true }, { id: "two", pinned: false }]);
  });
});
