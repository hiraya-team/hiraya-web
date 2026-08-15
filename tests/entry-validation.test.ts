import { describe, expect, test } from "bun:test";
import { validateEntryName } from "../src/lib/entry-validation";

describe("entry name validation feedback", () => {
  test.each([
    ["", "Enter a name."],
    ["   ", "Enter a name."],
    [".", "The names . and .. are reserved."],
    ["..", "The names . and .. are reserved."],
    ["bad/name", "A name cannot contain slashes."],
    ["bad\\name", "A name cannot contain slashes."],
    ["bad\u0000name", "A name cannot contain control characters."],
    ["a".repeat(181), "A name cannot exceed 180 characters."],
  ])("rejects %j with specific feedback", (value, message) => {
    expect(() => validateEntryName(value)).toThrow(message);
  });

  test("accepts and normalizes the 180-code-point boundary", () => {
    expect(validateEntryName("x".repeat(180))).toBe("x".repeat(180));
    expect(validateEntryName("😀".repeat(180))).toBe("😀".repeat(180));
    expect(validateEntryName("  report.txt  ")).toBe("report.txt");
  });
});
