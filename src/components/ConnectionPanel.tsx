import type { OutboxRecord } from "../lib/outbox";
import type { OfflineStorageInventory } from "../lib/offline-availability";
import type { OfflineOperationProgress, SyncStatus } from "../lib/sync";
import type { DesktopEntry } from "../types";
import type { StoragePersistenceStatus } from "../lib/storage-persistence";
import { OfflineStoragePanel } from "./OfflineStoragePanel";
import { SyncIssuesPanel } from "./SyncIssuesPanel";

type Props = {
  status: SyncStatus;
  records: readonly OutboxRecord[];
  lastSyncedAt?: number | null;
  affectedLabels?: (record: OutboxRecord) => readonly string[];
  entries: readonly DesktopEntry[];
  inventory: OfflineStorageInventory | null;
  progress: OfflineOperationProgress | null;
  online: boolean;
  persistence: StoragePersistenceStatus;
  onRetryRecord: (record: OutboxRecord) => void;
  onDiscardRecord: (record: OutboxRecord) => void;
  onRetryDownloads: () => void;
  onReleaseAll: () => void;
  onOpenHelp: () => void;
};

export function ConnectionPanel(props: Props) {
  return <section className="connection-panel">
    <header className="connection-panel__heading"><h2>Connection &amp; Offline</h2><p>Connection state, queued work, downloaded copies, and browser storage in one place.</p></header>
    <SyncIssuesPanel status={props.status} records={props.records} lastSyncedAt={props.lastSyncedAt} affectedLabels={props.affectedLabels} onRetry={props.onRetryRecord} onDiscard={props.onDiscardRecord} />
    <div className="connection-panel__explanation"><strong>{props.status === "local" ? "Browser-local desktop" : "Server-authoritative desktop"}</strong><span>{props.status === "local" ? "Files and changes exist only in this browser. Clearing site data removes them." : "Downloaded files are replaceable validated copies. Pending local changes exist only in this browser until synchronization completes."}</span></div>
    <div className="connection-panel__explanation"><strong>Browser storage: {props.persistence === "granted" ? "persistent" : props.persistence === "denied" ? "best effort" : props.persistence === "unsupported" ? "persistence unavailable" : "checking"}</strong><span>{props.persistence === "granted" ? "The browser granted stronger protection from automatic storage eviction." : props.persistence === "checking" ? "Requesting the strongest storage protection available without blocking your desktop." : "The browser may remove local-only files, queued changes, and downloaded copies under storage pressure. Clearing site data always removes them."}</span></div>
    <OfflineStoragePanel entries={props.entries} inventory={props.inventory} progress={props.progress} online={props.online} onRetry={props.onRetryDownloads} onReleaseAll={props.onReleaseAll} onOpenHelp={props.onOpenHelp} />
  </section>;
}
