import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MergeWindow, type MergeFileVersion } from "../src/components/MergeWindow";

const mine: MergeFileVersion = { name: "notes.txt", mimeType: "text/plain", size: 18, modifiedAt: Date.UTC(2026, 6, 1) };
const server: MergeFileVersion = { ...mine, size: 21, modifiedAt: Date.UTC(2026, 6, 2) };
const actions = { onKeepMine: () => undefined, onKeepServer: () => undefined, onKeepBoth: () => undefined };

describe("MergeWindow", () => {
  test("presents text conflicts without raw markers and blocks saving while unresolved", () => {
    const markup = renderToStaticMarkup(<MergeWindow {...actions} mode="text" mine={mine} server={server} state="ready" mergedText="A readable draft" onMergedTextChange={() => undefined} onResolveConflict={() => undefined} onSaveMerged={() => undefined} conflicts={[{ id: "heading", label: "Opening line", base: "Hello", mine: "Hello there", server: "Hello team", resolution: null }]} />);

    expect(markup).toContain("1 unresolved");
    expect(markup).toContain("Base");
    expect(markup).toContain("Use mine");
    expect(markup).toContain("Use server");
    expect(markup).toContain("Use both");
    expect(markup).toContain("A readable draft");
    expect(markup).toMatch(/disabled=""[^>]*><svg[^>]*FloppyDisk|disabled=""[^>]*>.*Save merged/);
    expect(markup).not.toContain("&lt;&lt;&lt;&lt;&lt;&lt;&lt;");
  });

  test("enables the merged save and exposes accessible source tabs once resolved", () => {
    const markup = renderToStaticMarkup(<MergeWindow {...actions} mode="text" mine={mine} server={server} state="ready" mergedText="Hello everyone" onMergedTextChange={() => undefined} onResolveConflict={() => undefined} onSaveMerged={() => undefined} conflicts={[{ id: "heading", base: "Hello", mine: "Hello there", server: "Hello team", resolution: "both" }]} />);

    expect(markup).toContain("Ready to save");
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Conflict sources"');
    expect(markup).toContain("Save merged</button>");
    expect(markup).not.toMatch(/disabled=""[^>]*>.*Save merged/);
  });

  test("shows File Viewer-equivalent details for binary versions", () => {
    const markup = renderToStaticMarkup(<MergeWindow {...actions} mode="binary" mine={{ ...mine, name: "archive.bin", mimeType: "application/octet-stream" }} server={{ ...server, name: "archive.bin", mimeType: "application/octet-stream" }} state="ready" />);

    expect(markup.match(/>Type</g)).toHaveLength(2);
    expect(markup.match(/>Size</g)).toHaveLength(2);
    expect(markup.match(/>Modified</g)).toHaveLength(2);
    expect(markup).toContain('aria-label="File versions"');
    expect(markup).toContain("Keep both");
  });
});
