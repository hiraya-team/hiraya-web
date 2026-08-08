import { describe, expect, test } from "bun:test";
import { dismissTopTransient, registerTransientDismiss } from "../src/ui/transient-dismiss";

describe("transient dismissal", () => {
  test("dismisses only the newest registered surface", () => {
    const dismissed: string[] = [];
    const unregisterFirst = registerTransientDismiss(() => dismissed.push("first"));
    const unregisterSecond = registerTransientDismiss(() => dismissed.push("second"));

    expect(dismissTopTransient()).toBe(true);
    expect(dismissed).toEqual(["second"]);

    unregisterSecond();
    expect(dismissTopTransient()).toBe(true);
    expect(dismissed).toEqual(["second", "first"]);

    unregisterFirst();
    expect(dismissTopTransient()).toBe(false);
  });
});
