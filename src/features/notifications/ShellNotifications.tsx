import { SpinnerGap, WarningCircle, X } from "@phosphor-icons/react";
import type { AppNotification } from "../../apps/host";
import { NotificationCard } from "../../components/NotificationCard";
import { StatusBadge } from "../../components/VisualPrimitives";
import { UpdateToast } from "../../components/UpdateToast";
import type { TrashNotification } from "../../lib/trash-notifications";
import { notificationPresentation } from "./controller";

type ImportProgress = { folderCount: number; fileCount: number; totalBytes: number; phase: "preparing" | "saving" | "syncing" };

type Props = {
  error: string;
  folderImportError: string;
  notice: string;
  trashNotifications: readonly TrashNotification[];
  appNotifications: readonly AppNotification[];
  importProgress: ImportProgress | null;
  showUpdateToast: boolean;
  updateApplying: boolean;
  updateBlocked: boolean;
  announcement: string;
  onDismissError: () => void;
  onOpenFolderImportHelp: () => void;
  onDismissNotice: () => void;
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
  const visibility = notificationPresentation(props.error, props.notice, props.trashNotifications.length, props.appNotifications.length);
  const visibleTrash = props.trashNotifications.slice(0, visibility.visibleTrash);
  const hiddenTrash = props.trashNotifications.slice(visibility.visibleTrash);
  const visibleApps = props.appNotifications.slice(0, visibility.visibleApps);
  const hiddenApps = props.appNotifications.slice(visibility.visibleApps);
  if (visibility.total === 0 && !props.importProgress && !props.showUpdateToast) return null;

  return (
    <aside className="shell-status-region" aria-label="Notifications and progress">
      {visibility.total > 0 && <div className="notification-stack">
        {visibility.showError && <NotificationCard badge="Error" tone="danger" icon={<WarningCircle size={18} weight="fill" />} role="alert" dismissLabel="Dismiss error" onDismiss={props.onDismissError} actions={props.error === props.folderImportError ? <button className="notification-action" type="button" onClick={props.onOpenFolderImportHelp}>Folder import help</button> : undefined}><span>{props.error}</span></NotificationCard>}
        {visibleTrash.map((notification) => <NotificationCard badge={notification.state === "failed" ? "Restore failed" : notification.state === "running" ? "Restoring" : "Undo available"} tone={notification.state === "failed" ? "danger" : notification.state === "running" ? "progress" : "neutral"} key={notification.id} dismissLabel={`Dismiss Trash notification for ${notification.label}`} dismissDisabled={notification.state === "running"} onDismiss={() => props.onDismissTrash(notification.id)} actions={<><button className="notification-action notification-action--primary" type="button" disabled={notification.state === "running"} onClick={() => props.onUndoTrash(notification)}>{notification.state === "failed" ? "Retry Undo" : "Undo"}</button><button className="notification-action" type="button" disabled={notification.state === "running"} onClick={() => props.onOpenTrash(notification)}>View Trash</button></>}><strong>{notification.label} moved to Trash</strong><span>{notification.state === "running" ? "Restoring..." : notification.error || "Undo remains available until dismissed."}</span></NotificationCard>)}
        {visibility.showNotice && <NotificationCard badge="Saved" role="status" dismissLabel="Dismiss notice" onDismiss={props.onDismissNotice}><span>{props.notice}</span></NotificationCard>}
        {visibleApps.map((notification) => <NotificationCard badge="App" key={notification.id} dismissLabel="Dismiss app notification" onDismiss={() => props.onDismissApp(notification)}><strong>{notification.title}</strong>{notification.body && <span>{notification.body}</span>}</NotificationCard>)}
        {visibility.hidden > 0 && <details className="notification-card notification-drawer"><summary>{visibility.hidden} more {visibility.hidden === 1 ? "notification" : "notifications"}</summary><div className="notification-drawer__list" aria-label="Notification history">
          {!visibility.showNotice && props.notice && <div><StatusBadge>Saved</StatusBadge><span>{props.notice}</span></div>}
          {hiddenTrash.map((notification) => <div key={notification.id}><StatusBadge tone={notification.state === "failed" ? "danger" : "neutral"}>Trash</StatusBadge><span>{notification.label}</span><button type="button" disabled={notification.state === "running"} onClick={() => props.onUndoTrash(notification)}>{notification.state === "failed" ? "Retry Undo" : "Undo"}</button><button type="button" onClick={() => props.onOpenTrash(notification)}>View</button><button className="notification-dismiss" type="button" disabled={notification.state === "running"} aria-label={`Dismiss notification for ${notification.label}`} onClick={() => props.onDismissTrash(notification.id)}><X size={14} /></button></div>)}
          {hiddenApps.map((notification) => <div key={notification.id}><StatusBadge>App</StatusBadge><span>{[notification.title, notification.body].filter(Boolean).join(": ")}</span><button className="notification-dismiss" type="button" aria-label="Dismiss app notification" onClick={() => props.onDismissApp(notification)}><X size={14} /></button></div>)}
        </div></details>}
      </div>}
      {props.importProgress && <NotificationCard badge="Importing" tone="progress" icon={<SpinnerGap className="notification-card__spinner" size={18} />} role="status"><strong>{props.importProgress.phase === "preparing" ? "Preparing import" : props.importProgress.phase === "saving" ? "Staging and saving import" : "Staging and synchronizing import"}</strong><span>{props.importProgress.folderCount} {props.importProgress.folderCount === 1 ? "folder" : "folders"}, {props.importProgress.fileCount} {props.importProgress.fileCount === 1 ? "file" : "files"}, {formatBytes(props.importProgress.totalBytes)}</span></NotificationCard>}
      {props.showUpdateToast && <UpdateToast applying={props.updateApplying} blocked={props.updateBlocked} onConfirm={props.onActivateUpdate} onDismiss={props.onDismissUpdate} />}
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{props.announcement}</span>
    </aside>
  );
}
