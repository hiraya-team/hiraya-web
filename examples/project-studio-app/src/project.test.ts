import { expect, test } from "bun:test";
import { buildPublication, markdownAssetPaths, parseProject, resolveProjectPath } from "./project";

const project = parseProject({
  schemaVersion: 1,
  title: "Field Notes",
  pages: [
    { path: "index.md", title: "Home" },
    { path: "notes/day-one.md", title: "Day one" },
  ],
});

test("validates project paths and resolves local resources", () => {
  expect(project.pages).toHaveLength(2);
  expect(resolveProjectPath("notes/day-one.md", "../assets/map.png")).toBe("assets/map.png");
  expect(resolveProjectPath("index.md", "../../secret.txt")).toBeNull();
  expect(() => parseProject({ schemaVersion: 1, title: "Bad", pages: [{ path: "../bad.md", title: "Bad" }] })).toThrow();
});

test("finds raster image dependencies and emits a self-contained publication", () => {
  expect(markdownAssetPaths("notes/day-one.md", "![Map](../assets/map.png) ![Remote](https://example.com/a.png)")).toEqual(["assets/map.png"]);
  const html = buildPublication({
    project,
    pages: new Map([["index.md", "Welcome [next](notes/day-one.md)."], ["notes/day-one.md", "![Map](../assets/map.png)"]]),
    assets: new Map([["assets/map.png", "data:image/png;base64,AA=="]]),
  });
  expect(html).toContain("href=\"#/notes/day-one\"");
  expect(html).toContain("data:image/png;base64,AA==");
  expect(html).not.toContain("https://example.com");
});

test("escapes project content and cannot terminate the generated style element", () => {
  const html = buildPublication({
    project: { schemaVersion: 1, title: "<script>alert(1)</script>", pages: [{ path: "index.md", title: "Home" }] },
    pages: new Map([["index.md", "<script>alert(2)</script>"]]),
    assets: new Map(),
    siteCss: "</style><script>alert(3)</script>",
  });
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).not.toContain("<script>alert(2)</script>");
  expect(html).not.toContain("</style><script>alert(3)</script>");
});
