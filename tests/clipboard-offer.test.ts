import { describe, expect, test } from "bun:test";
import { dismissClipboardOffer, observeClipboardOffer } from "../src/ui/clipboard-offer";

describe("clipboard paste offer", () => {
  test("stays dismissed when the same clipboard is observed again", () => {
    const offered = observeClipboardOffer(null, "clipboard-a");
    const dismissed = dismissClipboardOffer(offered);

    expect(observeClipboardOffer(dismissed, "clipboard-a")).toBe(dismissed);
    expect(dismissed?.dismissed).toBe(true);
  });

  test("returns for changed clipboard contents or an explicit copy", () => {
    const dismissed = dismissClipboardOffer(observeClipboardOffer(null, "clipboard-a"));
    expect(observeClipboardOffer(dismissed, "clipboard-b")).toEqual({ dismissed: false, key: "clipboard-b", revision: 2 });
    expect(observeClipboardOffer(dismissed, "clipboard-a", true)).toEqual({ dismissed: false, key: "clipboard-a", revision: 2 });
  });
});
