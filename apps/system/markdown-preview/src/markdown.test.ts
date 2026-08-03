import { expect, test } from "bun:test";
import { inlineParts, markdownResourceKind } from "./markdown";

test("keeps raw HTML as text and recognizes safe inline structures", () => {
  expect(inlineParts("<script>x</script> **safe** [guide](docs/guide.md)")).toEqual([
    { kind: "text", value: "<script>x</script> " },
    { kind: "strong", value: "safe" },
    { kind: "text", value: " " },
    { kind: "link", label: "guide", value: "docs/guide.md" },
  ]);
});

test("allows only HTTP embeds or local relative resources", () => {
  expect(markdownResourceKind("https://tracker.example/pixel")).toBe("external");
  expect(markdownResourceKind("images/photo.png")).toBe("relative");
  expect(markdownResourceKind("javascript:alert(1)")).toBe("blocked");
  expect(markdownResourceKind("data:image/svg+xml,<svg/>")).toBe("blocked");
  expect(markdownResourceKind("//tracker.example/pixel")).toBe("blocked");
});

test("uses shared warning actions without bypassing the external embed policy", async () => {
  const source = await Bun.file(new URL("./main.ts", import.meta.url)).text();
  expect(source).toContain('document.createElement("hiraya-notice")');
  expect(source.match(/document\.createElement\("hiraya-button"\)/g)).toHaveLength(2);
  expect(source).not.toContain('document.createElement("button")');
  expect(source).toContain("if (externalEmbeddedPreviews) { image.src = source; continue; }");
  expect(source).toContain("hiraya.host.setExternalEmbeddedPreviews(true)");
});
