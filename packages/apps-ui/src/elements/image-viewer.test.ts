import { describe, expect, test } from "bun:test";
import { calculateImageFitZoom, clampImageZoom } from "./image-viewer";

describe("image viewer geometry", () => {
  test("clamps zoom to the configured range", () => {
    expect(clampImageZoom(0.05, 0.1, 8)).toBe(0.1);
    expect(clampImageZoom(2, 0.1, 8)).toBe(2);
    expect(clampImageZoom(12, 0.1, 8)).toBe(8);
  });

  test("fits an image without exceeding either viewport axis", () => {
    expect(calculateImageFitZoom(800, 600, 1600, 900, 0.1, 8)).toBe(0.5);
    expect(calculateImageFitZoom(400, 800, 1000, 1000, 0.1, 8)).toBe(0.4);
  });

  test("uses the minimum for unavailable geometry", () => {
    expect(calculateImageFitZoom(0, 600, 1600, 900, 0.1, 8)).toBe(0.1);
  });
});
