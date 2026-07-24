import { expect, test } from "bun:test";
import { inlineParts } from "./markdown";

test("keeps raw HTML as text and recognizes safe inline structures", () => {
  expect(inlineParts("<script>x</script> **safe** [guide](docs/guide.md)")).toEqual([
    { kind: "text", value: "<script>x</script> " },
    { kind: "strong", value: "safe" },
    { kind: "text", value: " " },
    { kind: "link", label: "guide", value: "docs/guide.md" },
  ]);
});
