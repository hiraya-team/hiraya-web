import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Bell, ClockCounterClockwise, DownloadSimple, SpinnerGap, Tray, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import type { AppNotification } from "../../apps/host";
import { NotificationCard } from "../../components/NotificationCard";
import { UpdateToast } from "../../components/UpdateToast";
import type { TrashNotification } from "../../lib/trash-notifications";
import type { FileTransferState } from "../../lib/sync";
import { nextNotificationOrder, nextUnreadNotificationIds } from "./controller";

type ImportProgress = { folderCount: number; fileCount: number; totalBytes: number; phase: "preparing" | "saving" | "syncing" };

type NotificationItem =
  | { id: string; kind: "message"; value: ShellMessage }
  | { id: string; kind: "trash"; value: TrashNotification }
  | { id: string; kind: "app"; value: AppNotification }
  | { id: string; kind: "transfer"; value: FileTransferState }
  | { id: string; kind: "import"; value: ImportProgress }
  | { id: string; kind: "update" };

export type ShellMessage = {
  id: number;
  kind: "error" | "notice";
  message: string;
  folderImportHelp?: boolean;
};

type Props = {
  messages: readonly ShellMessage[];
  trashNotifications: readonly TrashNotification[];
  appNotifications: readonly AppNotification[];
  importProgress: ImportProgress | null;
  fileTransfers: readonly FileTransferState[];
  showUpdateToast: boolean;
  updateApplying: boolean;
  updateBlocked: boolean;
  announcement: string;
  canViewActivity: boolean;
  onDismissMessage: (id: number) => void;
  onOpenFolderImportHelp: () => void;
  onDismissTrash: (id: string) => void;
  onUndoTrash: (notification: TrashNotification) => void;
  onOpenTrash: (notification: TrashNotification) => void;
  onDismissApp: (notification: AppNotification) => void;
  onDismissTransfer: (id: string) => void;
  onActivateUpdate: () => void;
  onDismissUpdate: () => void;
  onViewActivity: () => void;
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function transferLabel(transfer: FileTransferState) {
  if (transfer.phase === "failed") return `${transfer.direction === "upload" ? "Upload" : "Download"} failed`;
  if (transfer.phase === "complete") return `${transfer.direction === "upload" ? "Upload" : "Download"} complete`;
  if (transfer.phase === "hashing") return "Preparing upload";
  if (transfer.phase === "access") return `Preparing ${transfer.direction}`;
  if (transfer.phase === "finalizing") return `Finalizing ${transfer.direction}`;
  return transfer.direction === "upload" ? "Uploading" : "Downloading";
}

export function ShellNotifications(props: Props) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState<ReadonlySet<string>>(new Set());
  const knownItemsRef = useRef<ReadonlySet<string>>(new Set());
  const itemOrderRef = useRef<readonly string[]>([]);
  const items = useMemo<NotificationItem[]>(() => [
    ...props.messages.map((value) => ({ id: `message:${value.id}`, kind: "message" as const, value })),
    ...props.trashNotifications.map((value) => ({ id: `trash:${value.id}`, kind: "trash" as const, value })),
    ...props.appNotifications.map((value) => ({ id: `app:${value.owner.instanceId}:${value.id}`, kind: "app" as const, value })),
    ...props.fileTransfers.map((value) => ({ id: `transfer:${value.id}`, kind: "transfer" as const, value })),
    ...(props.importProgress ? [{ id: "import", kind: "import" as const, value: props.importProgress }] : []),
    ...(props.showUpdateToast ? [{ id: "update", kind: "update" as const }] : []),
  ], [props.appNotifications, props.fileTransfers, props.importProgress, props.messages, props.showUpdateToast, props.trashNotifications]);
  const itemIds = items.map((item) => item.id);
  itemOrderRef.current = nextNotificationOrder(itemOrderRef.current, itemIds);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const orderedItems = itemOrderRef.current.map((id) => itemById.get(id)).filter((item): item is NotificationItem => item !== undefined);
  const total = itemIds.length;

  useEffect(() => {
    const nextItems = new Set(itemIds);
    setUnread((current) => nextUnreadNotificationIds(current, knownItemsRef.current, nextItems, open));
    knownItemsRef.current = nextItems;
  }, [itemIds, open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus());
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) setUnread(new Set());
  };

  return <>
    <div className="notification-center" ref={rootRef}>
      <button
        ref={triggerRef}
        className="notification-center__trigger"
        type="button"
        aria-label={`Notifications${unread.size ? `, ${unread.size} unread` : ""}`}
        title="Notifications"
        aria-controls={panelId}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        <Bell size={18} weight={unread.size ? "fill" : "regular"} aria-hidden="true" />
        {unread.size > 0 && <span className="notification-center__badge" aria-hidden="true">{unread.size > 99 ? "99+" : unread.size}</span>}
      </button>
      {open && <div ref={panelRef} id={panelId} className="notification-center__panel" role="dialog" aria-label="Notifications">
        <header className="notification-center__header">
          <div><strong>Notifications</strong><span>{total ? `${total} active` : "You're all caught up"}</span></div>
          <button type="button" aria-label="Close notifications" onClick={() => { setOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()); }}>Close</button>
        </header>
        <div className="notification-center__list">
          {orderedItems.map((item) => {
            if (item.kind === "message") {
              const message = item.value;
              return <NotificationCard badge={message.kind === "error" ? "Error" : "Saved"} tone={message.kind === "error" ? "danger" : "neutral"} icon={message.kind === "error" ? <WarningCircle size={18} weight="fill" /> : undefined} key={item.id} dismissLabel={`Dismiss ${message.kind}`} onDismiss={() => props.onDismissMessage(message.id)} actions={message.folderImportHelp ? <button className="notification-action" type="button" onClick={props.onOpenFolderImportHelp}>Folder import help</button> : undefined}><span>{message.message}</span></NotificationCard>;
            }
            if (item.kind === "trash") {
              const notification = item.value;
              return <NotificationCard badge={notification.state === "failed" ? "Restore failed" : notification.state === "running" ? "Restoring" : "Undo available"} tone={notification.state === "failed" ? "danger" : notification.state === "running" ? "progress" : "neutral"} key={item.id} dismissLabel={`Dismiss Trash notification for ${notification.label}`} dismissDisabled={notification.state === "running"} onDismiss={() => props.onDismissTrash(notification.id)} actions={<><button className="notification-action notification-action--primary" type="button" disabled={notification.state === "running"} onClick={() => props.onUndoTrash(notification)}>{notification.state === "failed" ? "Retry Undo" : "Undo"}</button><button className="notification-action" type="button" disabled={notification.state === "running"} onClick={() => props.onOpenTrash(notification)}>View Trash</button></>}><strong>{notification.label} moved to Trash</strong><span>{notification.state === "running" ? "Restoring..." : notification.error || "Undo remains available until dismissed."}</span></NotificationCard>;
            }
            if (item.kind === "app") {
              const notification = item.value;
              return <NotificationCard badge="App" key={item.id} dismissLabel="Dismiss app notification" onDismiss={() => props.onDismissApp(notification)}><strong>{notification.title}</strong>{notification.body && <span>{notification.body}</span>}</NotificationCard>;
            }
            if (item.kind === "transfer") {
              const transfer = item.value;
              const label = transferLabel(transfer);
              const determinate = transfer.phase === "hashing" || transfer.phase === "uploading" || transfer.phase === "downloading" || transfer.phase === "complete";
              return <NotificationCard badge={transfer.direction === "upload" ? "Upload" : "Download"} tone={transfer.phase === "failed" ? "danger" : transfer.phase === "complete" ? "success" : "progress"} icon={transfer.direction === "upload" ? <UploadSimple size={18} /> : <DownloadSimple size={18} />} key={item.id} dismissLabel={transfer.phase === "failed" ? `Dismiss failed ${transfer.direction} for ${transfer.fileName}` : undefined} onDismiss={transfer.phase === "failed" ? () => props.onDismissTransfer(transfer.id) : undefined} role={transfer.phase === "failed" ? "alert" : undefined}>
                <strong>{transfer.fileName}</strong>
                <span>{label}{determinate ? `, ${formatBytes(transfer.transferredBytes)} of ${formatBytes(transfer.totalBytes)}` : ""}</span>
                {transfer.phase !== "failed" && transfer.phase !== "complete" && <progress className="notification-transfer__progress" max={Math.max(1, transfer.totalBytes)} value={determinate ? Math.min(transfer.transferredBytes, transfer.totalBytes) : undefined} aria-label={`${label} progress for ${transfer.fileName}`} />}
                {transfer.error && <span>{transfer.error}</span>}
              </NotificationCard>;
            }
            if (item.kind === "import") {
              const progress = item.value;
              return <NotificationCard key={item.id} badge="Importing" tone="progress" icon={<SpinnerGap className="notification-card__spinner" size={18} />}><strong>{progress.phase === "preparing" ? "Preparing import" : progress.phase === "saving" ? "Staging and saving import" : "Staging and synchronizing import"}</strong><span>{progress.folderCount} {progress.folderCount === 1 ? "folder" : "folders"}, {progress.fileCount} {progress.fileCount === 1 ? "file" : "files"}, {formatBytes(progress.totalBytes)}</span></NotificationCard>;
            }
            return <UpdateToast key={item.id} applying={props.updateApplying} blocked={props.updateBlocked} onConfirm={props.onActivateUpdate} onDismiss={props.onDismissUpdate} />;
          })}
          {total === 0 && <div className="notification-center__empty"><Tray size={30} weight="duotone" /><strong>No notifications</strong><span>Current alerts and actions will appear here.</span></div>}
        </div>
        {props.canViewActivity && <footer className="notification-center__footer"><button type="button" onClick={() => { setOpen(false); props.onViewActivity(); }}><ClockCounterClockwise size={17} aria-hidden="true" />View activity</button></footer>}
      </div>}
    </div>
    <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{props.announcement}</span>
  </>;
}
