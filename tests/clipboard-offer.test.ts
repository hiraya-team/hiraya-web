import { describe, expect, test } from "bun:test";
import { dismissClipboardOffer, observeClipboardOffer, persistClipboardOffer, restoreClipboardOffer } from "../src/ui/clipboard-offer";

/** Builds the memory storage test fixture. */
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

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

  test("restores a dismissed clipboard after a reload", () => {
    const storage = memoryStorage();
    persistClipboardOffer(storage, dismissClipboardOffer(observeClipboardOffer(null, "clipboard-a")));

    const restored = restoreClipboardOffer(storage);
    expect(restored).toEqual({ dismissed: true, key: "clipboard-a", revision: 0 });
    expect(observeClipboardOffer(restored, "clipboard-a")).toBe(restored);
  });

  test("clears persisted dismissal when a clipboard is offered again", () => {
    const storage = memoryStorage();
    persistClipboardOffer(storage, dismissClipboardOffer(observeClipboardOffer(null, "clipboard-a")));
    persistClipboardOffer(storage, observeClipboardOffer(restoreClipboardOffer(storage), "clipboard-a", true));

    expect(restoreClipboardOffer(storage)).toBeNull();
  });
});
