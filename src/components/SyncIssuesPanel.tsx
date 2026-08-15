import { useId } from "react";
import { ArrowsClockwise, CloudCheck, CloudSlash, GitMerge, Trash, WarningCircle } from "@phosphor-icons/react";
import { isRevisionConflictRecord, outboxBlockingRecord, type OutboxRecord } from "../lib/outbox";
import type { SyncStatus } from "../lib/sync";
import { outboxRecordLabel, partitionSyncRecords } from "../ui/panel-data";
import { ItemList } from "./ItemList";

export type SyncIssuesPanelProps = {
  status: SyncStatus;
  records: readonly OutboxRecord[];
  lastSyncedAt?: number | null;
  affectedLabels?: (record: OutboxRecord) => readonly string[];
  onRetry: (record: OutboxRecord) => void;
  onDiscard: (record: OutboxRecord) => void;
  onOpenHelp?: () => void;
};

function statusCopy(status: SyncStatus, recordCount: number, lastSyncedAt?: number | null) {
  if (status === "local") return "Changes stay in this browser.";
  if (status === "offline") return lastSyncedAt ? `Offline. Last synced ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(lastSyncedAt)}.` : "Offline. This desktop has not synced yet.";
  if (status === "blocked") return `${recordCount} ${recordCount === 1 ? "change needs" : "changes need"} attention before sync can continue.`;
  if (status === "upgrade-required") return "This server uses an unsupported data version. Update Hiraya before queued changes can sync.";
  if (status === "error") return "The server identity or synchronization response is invalid. Queued changes have not been sent.";
  if (status === "connecting") return "Connecting to the shared desktop...";
  return recordCount > 0 ? "Connected. Pending changes will sync automatically." : "Connected. Everything is up to date.";
}

export function SyncIssuesPanel({ status, records, lastSyncedAt, affectedLabels, onRetry, onDiscard, onOpenHelp }: SyncIssuesPanelProps) {
  const groups = partitionSyncRecords(records);
  const titleId = useId();
  return <section className="sync-issues-panel" aria-labelledby={titleId}>
    <header className="sync-issues-panel__status" data-status={status}>
      {status === "online" || status === "local" ? <CloudCheck size={24} weight="duotone" aria-hidden="true" /> : status === "blocked" ? <WarningCircle size={24} weight="duotone" aria-hidden="true" /> : <CloudSlash size={24} weight="duotone" aria-hidden="true" />}
      <div><h2 id={titleId}>Sync status</h2><p role="status">{statusCopy(status, records.length, lastSyncedAt)}</p></div>
    </header>
    {records.length === 0 ? <div className="sync-issues-panel__empty"><CloudCheck size={30} weight="duotone" aria-hidden="true" /><strong>No sync issues</strong><span>Your changes are accounted for.</span></div> : ([
      ["blocked", groups.blocked],
      ["pending", groups.pending],
    ] as const).map(([label, group]) => group.length > 0 && <section className="sync-issues-panel__group" key={label} aria-labelledby={`${titleId}-${label}`}>
      <h3 id={`${titleId}-${label}`}>{label === "blocked" ? "Needs attention" : "Waiting to sync"} <span>{group.length}</span></h3>
      <ItemList items={group} getId={(record) => record.operationId} label={label === "blocked" ? "Sync issues needing attention" : "Changes waiting to sync"} className="sync-issues-panel__records" renderItem={(record, { itemProps }) => {
        const labels = affectedLabels?.(record) ?? [];
        const conflict = isRevisionConflictRecord(record) ? record.conflictDetails! : null;
        const contentConflict = conflict?.resourceKind === "content" && record.operation.kind === "save-content";
        const blocker = record.status === "pending" ? outboxBlockingRecord(records, record) : null;
        return <li {...itemProps} className="sync-issues-panel__record" key={record.operationId}>
          <div><strong>{outboxRecordLabel(record)}</strong>{labels.length > 0 && <p>{labels.join(", ")}</p>}{record.attemptCount > 0 && <p>{record.attemptCount === 1 ? "1 sync attempt" : `${record.attemptCount} sync attempts`}{record.lastAttemptAt ? `, last tried ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(record.lastAttemptAt)}` : ""}</p>}{record.error && <p className="form-error">{record.error}</p>}{conflict && <p>Your change remains saved locally. Keep your change applies it over the latest server state; use server state discards this queued change.</p>}{blocker && <p>Waiting for {outboxRecordLabel(blocker)} to be resolved.</p>}</div>
          {record.status === "blocked" && <div className="sync-issues-panel__actions">
            <button className="button button--quiet" type="button" onClick={() => onRetry(record)}>{conflict ? <GitMerge size={16} /> : <ArrowsClockwise size={16} />}{contentConflict ? "Review versions" : conflict ? "Keep my change" : "Retry"}</button>
            <button className="button button--quiet" type="button" onClick={() => onDiscard(record)}><Trash size={16} /> {conflict ? "Use server state" : "Discard"}</button>
          </div>}
        </li>;
      }} />
    </section>)}
    {onOpenHelp && <button className="inline-help-link" type="button" onClick={onOpenHelp}>Sync and offline troubleshooting</button>}
  </section>;
}
