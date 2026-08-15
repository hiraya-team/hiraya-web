import { describe, expect, test } from "bun:test";
import { nextQuitBack } from "../src/ui/back-navigation";

describe("root Back confirmation", () => {
  test("requires three presses and resets after three seconds", () => {
    const first = nextQuitBack({ count: 0, lastAt: 0 }, 10_000);
    expect(first).toMatchObject({ quit: false, message: "Press Back twice more to quit Hiraya." });
    const second = nextQuitBack(first.state, 11_000);
    expect(second).toMatchObject({ quit: false, message: "Press Back once more to quit Hiraya." });
    expect(nextQuitBack(second.state, 12_000).quit).toBe(true);
    expect(nextQuitBack(second.state, 15_001).state.count).toBe(1);
  });
});
