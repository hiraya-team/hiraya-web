import { diff3Merge } from "node-diff3";

/** Defines the maximum byte size for a three-way text merge. */
export const THREE_WAY_TEXT_MERGE_MAX_BYTES = 1024 * 1024;
/** Defines the maximum line count for a three-way text merge. */
export const THREE_WAY_TEXT_MERGE_MAX_LINES = 20_000;

export type ThreeWayTextMergeSource = "base" | "mine" | "server";

export type ThreeWayTextMergeUnavailableReason =
  | { kind: "invalid-utf8"; source: ThreeWayTextMergeSource }
  | { kind: "too-large"; source: ThreeWayTextMergeSource; limitBytes: number }
  | { kind: "too-many-lines"; source: ThreeWayTextMergeSource; limitLines: number };

export type ThreeWayTextMergeRegion =
  | { kind: "resolved"; text: string }
  | { kind: "unresolved"; base: string; mine: string; server: string };

export type ThreeWayTextMergeResult =
  | { status: "merged"; text: string; regions: Array<Extract<ThreeWayTextMergeRegion, { kind: "resolved" }>> }
  | { status: "conflict"; regions: ThreeWayTextMergeRegion[] }
  | { status: "unavailable"; reason: ThreeWayTextMergeUnavailableReason };

/** Decodes UTF-8 bytes for text merging. */
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Splits text into mergeable lines. */
function lines(text: string) {
  return text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
}

/** Decodes a text version within the merge size limit. */
function decode(source: ThreeWayTextMergeSource, bytes: Uint8Array): string | ThreeWayTextMergeUnavailableReason {
  if (bytes.byteLength > THREE_WAY_TEXT_MERGE_MAX_BYTES) {
    return { kind: "too-large", source, limitBytes: THREE_WAY_TEXT_MERGE_MAX_BYTES };
  }

  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return { kind: "invalid-utf8", source };
  }

  if (lines(text).length > THREE_WAY_TEXT_MERGE_MAX_LINES) {
    return { kind: "too-many-lines", source, limitLines: THREE_WAY_TEXT_MERGE_MAX_LINES };
  }
  return text;
}

/** Performs a three-way text merge. */
export function mergeThreeWayText(baseBytes: Uint8Array, mineBytes: Uint8Array, serverBytes: Uint8Array): ThreeWayTextMergeResult {
  const decoded: Partial<Record<ThreeWayTextMergeSource, string>> = {};
  for (const [source, bytes] of [["base", baseBytes], ["mine", mineBytes], ["server", serverBytes]] as const) {
    const result = decode(source, bytes);
    if (typeof result !== "string") return { status: "unavailable", reason: result };
    decoded[source] = result;
  }

  const regions: ThreeWayTextMergeRegion[] = diff3Merge(lines(decoded.mine!), lines(decoded.base!), lines(decoded.server!), {
    excludeFalseConflicts: true,
  }).map((region) => region.ok
    ? { kind: "resolved", text: region.ok.join("") }
    : {
        kind: "unresolved",
        base: region.conflict!.o.join(""),
        mine: region.conflict!.a.join(""),
        server: region.conflict!.b.join(""),
      });

  if (regions.some((region) => region.kind === "unresolved")) return { status: "conflict", regions };
  const resolved = regions as Array<Extract<ThreeWayTextMergeRegion, { kind: "resolved" }>>;
  return { status: "merged", text: resolved.map((region) => region.text).join(""), regions: resolved };
}
