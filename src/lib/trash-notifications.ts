export type TrashNotification = {
  id: string;
  desktopId: string;
  label: string;
  rootIds: string[];
  state: "ready" | "running" | "failed";
  error?: string;
};

/** Creates trash notification. */
export function createTrashNotification(desktopId: string, label: string, rootIds: string[], id = crypto.randomUUID()): TrashNotification {
  return { id, desktopId, label, rootIds: [...rootIds], state: "ready" };
}

/** Updates trash notification. */
export function updateTrashNotification(notifications: readonly TrashNotification[], id: string, state: TrashNotification["state"], error?: string) {
  return notifications.map((notification) => notification.id === id ? { ...notification, state, ...(error ? { error } : { error: undefined }) } : notification);
}

/** Dismisses trash notification. */
export function dismissTrashNotification(notifications: readonly TrashNotification[], id: string) {
  return notifications.filter((notification) => notification.id !== id);
}
