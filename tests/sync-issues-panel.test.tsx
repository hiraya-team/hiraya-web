import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SyncIssuesPanel } from "../src/components/SyncIssuesPanel";
import type { OutboxRecord } from "../src/lib/outbox";

test("explains durable conflict choices and causal waiting", () => {
  const blocked: OutboxRecord = {
    operationId: "1",
    sequence: 1,
    clientId: "client",
    catalogId: "catalog",
    desktopId: "desk",
    operation: { schemaVersion: 1, kind: "patch-entry", entryId: "file", changes: { name: "local.txt" } },
    status: "blocked",
    error: "Both your change and the server changed name. Choose which version to keep.",
    errorCode: "revision_conflict",
    conflictDetails: { resourceKind: "entry", resourceId: "file", expectedRevision: 1, actualRevision: 2 },
    attemptCount: 1,
    lastAttemptAt: null,
  };
  const pending: OutboxRecord = {
    ...blocked,
    operationId: "2",
    sequence: 2,
    operation: { schemaVersion: 1, kind: "patch-entry", entryId: "file", changes: { position: { x: 1, y: 2 } } },
    status: "pending",
    error: null,
    errorCode: null,
    conflictDetails: null,
  };

  const markup = renderToStaticMarkup(<SyncIssuesPanel status="blocked" records={[blocked, pending]} onRetry={() => undefined} onDiscard={() => undefined} />);
  expect(markup).toContain("Keep my change");
  expect(markup).toContain("Use server state");
  expect(markup).toContain("remains saved locally");
  expect(markup).toContain("Waiting for Update item to be resolved.");
});

test("opens version review for blocked file-content conflicts", () => {
  const blocked: OutboxRecord = {
    operationId: "content-conflict",
    sequence: 1,
    clientId: "client",
    catalogId: "catalog",
    desktopId: "desk",
    operation: { schemaVersion: 1, kind: "save-content", entryId: "file", mimeType: "text/plain", size: 12, modifiedAt: 1, baseContentRevision: 1 },
    status: "blocked",
    error: "The file changed on the server.",
    errorCode: "revision_conflict",
    conflictDetails: { resourceKind: "content", resourceId: "file", expectedRevision: 1, actualRevision: 2 },
    attemptCount: 1,
    lastAttemptAt: null,
  };

  const markup = renderToStaticMarkup(<SyncIssuesPanel status="blocked" records={[blocked]} onRetry={() => undefined} onDiscard={() => undefined} />);
  expect(markup).toContain("Review versions");
  expect(markup).not.toContain("Keep my change</button>");
  expect(markup).toContain("Use server state");
});
