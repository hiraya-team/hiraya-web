import type { SyncStatus } from "../../lib/sync";
import type { OutboxRecord } from "../../lib/outbox";
import type { StatusTone } from "../../components/VisualPrimitives";

export type ConnectionIndicatorStatus = SyncStatus | "syncing" | "waiting";

export function connectionIndicator(status: SyncStatus, syncing: boolean, outboxRecords: readonly OutboxRecord[]) {
  const hasPending = outboxRecords.some((record) => record.status === "pending");
  const indicatorStatus: ConnectionIndicatorStatus = status === "online" && syncing ? "syncing" : status === "online" && hasPending ? "waiting" : status;
  const tone: StatusTone = indicatorStatus === "online" || indicatorStatus === "local" ? "success" : indicatorStatus === "connecting" || indicatorStatus === "syncing" ? "progress" : indicatorStatus === "waiting" ? "neutral" : "danger";
  return { status: indicatorStatus, tone };
}
