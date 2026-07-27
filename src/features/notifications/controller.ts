import { boundedNotificationVisibility } from "../../ui/notifications";

export function notificationPresentation(error: string, notice: string, trashCount: number, appCount: number) {
  return boundedNotificationVisibility({ error: Boolean(error), notice: Boolean(notice), trash: trashCount, apps: appCount });
}
