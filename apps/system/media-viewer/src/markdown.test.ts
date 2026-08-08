import { describe, expect, test } from "bun:test";
import { markdownHtml, markdownRelativePath, markdownResourceKind } from "./markdown";

describe("GFM markdown", () => {
  test("renders GFM structures without enabling raw HTML", () => {
    const html = markdownHtml("~~done~~\n\n- [x] checked\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nwww.example.com\n\n<script>alert(1)</script>");
    expect(html).toContain("<del>done</del>");
    expect(html).toMatch(/type="checkbox"[^>]*disabled=""[^>]*checked=""/);
    expect(html).toContain("<table>");
    expect(html).toContain('href="http://www.example.com"');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  test("allows only HTTP embeds or local relative resources", () => {
    expect(markdownResourceKind("https://tracker.example/pixel")).toBe("external");
    expect(markdownResourceKind("images/photo.png")).toBe("relative");
    expect(markdownResourceKind("images/photo%20one.png")).toBe("relative");
    expect(markdownRelativePath("images/photo%20%231%3F.png")).toBe("images/photo #1?.png");
    expect(markdownResourceKind("javascript:alert(1)")).toBe("blocked");
    expect(markdownResourceKind("data:image/svg+xml,<svg/>")).toBe("blocked");
    expect(markdownResourceKind("//tracker.example/pixel")).toBe("blocked");
    expect(markdownResourceKind("/root/image.png")).toBe("blocked");
    expect(markdownResourceKind("images%5Cphoto.png")).toBe("blocked");
  });

  test("rewrites resources before attaching sanitized content", async () => {
    const source = await Bun.file(new URL("./markdown.ts", import.meta.url)).text();
    expect(source).toContain("DOMPurify.sanitize");
    expect(source.indexOf('image.removeAttribute("src")')).toBeLessThan(source.indexOf("article.append(content)"));
    expect(source).toContain('link.rel = "noopener noreferrer"');
    expect(source).toContain("decodeURIComponent(value)");
  });
});
