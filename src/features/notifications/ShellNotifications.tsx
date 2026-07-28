import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Bell, SpinnerGap, Tray, WarningCircle } from "@phosphor-icons/react";
import type { AppNotification } from "../../apps/host";
import { NotificationCard } from "../../components/NotificationCard";
import { UpdateToast } from "../../components/UpdateToast";
import type { TrashNotification } from "../../lib/trash-notifications";
import { nextUnreadNotificationIds } from "./controller";

type ImportProgress = { folderCount: number; fileCount: number; totalBytes: number; phase: "preparing" | "saving" | "syncing" };

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
  showUpdateToast: boolean;
  updateApplying: boolean;
  updateBlocked: boolean;
  announcement: string;
  onDismissMessage: (id: number) => void;
  onOpenFolderImportHelp: () => void;
  onDismissTrash: (id: string) => void;
  onUndoTrash: (notification: TrashNotification) => void;
  onOpenTrash: (notification: TrashNotification) => void;
  onDismissApp: (notification: AppNotification) => void;
  onActivateUpdate: () => void;
  onDismissUpdate: () => void;
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export function ShellNotifications(props: Props) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState<ReadonlySet<string>>(new Set());
  const knownItemsRef = useRef<ReadonlySet<string>>(new Set());
  const itemIds = useMemo(() => [
    ...props.messages.map((message) => `message:${message.id}`),
    ...props.trashNotifications.map((notification) => `trash:${notification.id}`),
    ...props.appNotifications.map((notification) => `app:${notification.owner.instanceId}:${notification.id}`),
    ...(props.importProgress ? ["import"] : []),
    ...(props.showUpdateToast ? ["update"] : []),
  ], [props.appNotifications, props.importProgress, props.messages, props.showUpdateToast, props.trashNotifications]);
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
          {[...props.messages].reverse().map((message) => <NotificationCard
            badge={message.kind === "error" ? "Error" : "Saved"}
            tone={message.kind === "error" ? "danger" : "neutral"}
            icon={message.kind === "error" ? <WarningCircle size={18} weight="fill" /> : undefined}
            key={message.id}
            dismissLabel={`Dismiss ${message.kind}`}
            onDismiss={() => props.onDismissMessage(message.id)}
            actions={message.folderImportHelp ? <button className="notification-action" type="button" onClick={props.onOpenFolderImportHelp}>Folder import help</button> : undefined}
          ><span>{message.message}</span></NotificationCard>)}
          {[...props.trashNotifications].reverse().map((notification) => <NotificationCard badge={notification.state === "failed" ? "Restore failed" : notification.state === "running" ? "Restoring" : "Undo available"} tone={notification.state === "failed" ? "danger" : notification.state === "running" ? "progress" : "neutral"} key={notification.id} dismissLabel={`Dismiss Trash notification for ${notification.label}`} dismissDisabled={notification.state === "running"} onDismiss={() => props.onDismissTrash(notification.id)} actions={<><button className="notification-action notification-action--primary" type="button" disabled={notification.state === "running"} onClick={() => props.onUndoTrash(notification)}>{notification.state === "failed" ? "Retry Undo" : "Undo"}</button><button className="notification-action" type="button" disabled={notification.state === "running"} onClick={() => props.onOpenTrash(notification)}>View Trash</button></>}><strong>{notification.label} moved to Trash</strong><span>{notification.state === "running" ? "Restoring..." : notification.error || "Undo remains available until dismissed."}</span></NotificationCard>)}
          {[...props.appNotifications].reverse().map((notification) => <NotificationCard badge="App" key={`${notification.owner.instanceId}:${notification.id}`} dismissLabel="Dismiss app notification" onDismiss={() => props.onDismissApp(notification)}><strong>{notification.title}</strong>{notification.body && <span>{notification.body}</span>}</NotificationCard>)}
          {props.importProgress && <NotificationCard badge="Importing" tone="progress" icon={<SpinnerGap className="notification-card__spinner" size={18} />}><strong>{props.importProgress.phase === "preparing" ? "Preparing import" : props.importProgress.phase === "saving" ? "Staging and saving import" : "Staging and synchronizing import"}</strong><span>{props.importProgress.folderCount} {props.importProgress.folderCount === 1 ? "folder" : "folders"}, {props.importProgress.fileCount} {props.importProgress.fileCount === 1 ? "file" : "files"}, {formatBytes(props.importProgress.totalBytes)}</span></NotificationCard>}
          {props.showUpdateToast && <UpdateToast applying={props.updateApplying} blocked={props.updateBlocked} onConfirm={props.onActivateUpdate} onDismiss={props.onDismissUpdate} />}
          {total === 0 && <div className="notification-center__empty"><Tray size={30} weight="duotone" /><strong>No notifications</strong><span>New activity and actions will appear here.</span></div>}
        </div>
      </div>}
    </div>
    <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{props.announcement}</span>
  </>;
}
