import { ClockCountdown, CloudCheck, CloudSlash, HardDrive, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import type { SyncStatus } from "../../lib/sync";
import type { OutboxRecord } from "../../lib/outbox";
import { StatusBadge } from "../../components/VisualPrimitives";
import { connectionIndicator } from "./controller";

type Props = {
  status: SyncStatus;
  syncing: boolean;
  outboxRecords: readonly OutboxRecord[];
  onOpen: () => void;
};

export function ConnectionStatusButton({ status, syncing, outboxRecords, onOpen }: Props) {
  const indicator = connectionIndicator(status, syncing, outboxRecords);
  const label = indicator.status === "local" ? "Saved locally" : indicator.status === "syncing" ? "Syncing in background" : indicator.status === "waiting" ? "Waiting to sync" : indicator.status === "online" ? "Synced" : indicator.status === "connecting" ? "Connecting" : indicator.status === "blocked" ? "Sync blocked" : indicator.status === "upgrade-required" ? "Update required" : indicator.status === "error" ? "Sync error" : "Offline";
  const recovery = indicator.status === "blocked" ? ". Open Connection and Offline to resolve queued changes" : indicator.status === "upgrade-required" ? ". Update Hiraya before syncing queued changes" : indicator.status === "error" ? ". Open Connection and Offline for details" : indicator.status === "offline" || indicator.status === "waiting" ? ". Open Connection and Offline for recovery options" : ". Open Connection and Offline";
  return (
    <button className="menu-bar__sync" data-status={indicator.status} type="button" aria-label={`${label}${recovery}`} onClick={onOpen}>
      <StatusBadge tone={indicator.tone} surface="chrome">
        {indicator.status === "local" ? <HardDrive size={15} /> : indicator.status === "online" ? <CloudCheck size={15} /> : indicator.status === "waiting" ? <ClockCountdown size={15} /> : indicator.status === "blocked" ? <WarningCircle size={15} weight="fill" /> : indicator.status === "connecting" || indicator.status === "syncing" ? <SpinnerGap size={15} /> : <CloudSlash size={15} />}
        <span>{label}</span>
      </StatusBadge>
    </button>
  );
}
