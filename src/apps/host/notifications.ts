import type { ServiceMethods } from "@hiraya-team/apps-contracts";
import { hasControlCharacters, HostServiceError, instanceKey, type AppInstanceOwner } from "./types";

/** Caps active notifications owned by one app instance. */
export const MAX_NOTIFICATIONS_PER_INSTANCE = 16;
/** Caps hosted app notification title length. */
export const MAX_NOTIFICATION_TITLE_LENGTH = 120;
/** Caps hosted app notification body length. */
export const MAX_NOTIFICATION_BODY_LENGTH = 1_000;

export type AppNotification = Readonly<{
  id: string;
  owner: AppInstanceOwner;
  title: string;
  body?: string;
  tag?: string;
}>;

export interface AppNotificationApi {
  show(params: ServiceMethods["notifications.show"]["params"]): Promise<{ id: string }>;
  dismiss(id: string): Promise<void>;
}

/** Owns validated notifications emitted by hosted app instances. */
export class AppNotificationService {
  readonly #notifications = new Map<string, AppNotification>();
  readonly #listeners = new Set<(notifications: readonly AppNotification[]) => void>();
  #nextId = 0;

  /** Creates the notification API scoped to one app instance. */
  forInstance(owner: AppInstanceOwner): AppNotificationApi {
    return {
      show: async (params) => ({ id: this.show(owner, params).id }),
      dismiss: async (id) => this.dismiss(owner, id),
    };
  }

  /** Lists active notifications in insertion order. */
  list(): readonly AppNotification[] {
    return [...this.#notifications.values()];
  }

  /** Validates and publishes a notification for an app instance. */
  show(owner: AppInstanceOwner, params: ServiceMethods["notifications.show"]["params"]): AppNotification {
    boundedText(params.title, "Notification title", MAX_NOTIFICATION_TITLE_LENGTH);
    if (params.body !== undefined) boundedText(params.body, "Notification body", MAX_NOTIFICATION_BODY_LENGTH, true);
    if (params.tag !== undefined) boundedText(params.tag, "Notification tag", 128);
    const key = instanceKey(owner);
    if ([...this.#notifications.values()].filter((item) => instanceKey(item.owner) === key).length >= MAX_NOTIFICATIONS_PER_INSTANCE) {
      throw new HostServiceError("Too many notifications are active.", "QUOTA_EXCEEDED");
    }
    const notification: AppNotification = { id: `notification-${++this.#nextId}`, owner, ...params };
    this.#notifications.set(notification.id, notification);
    this.#publish();
    return notification;
  }

  /** Dismisses a notification owned by the requesting app instance. */
  dismiss(owner: AppInstanceOwner, id: string): void {
    const notification = this.#notifications.get(id);
    if (!notification || instanceKey(notification.owner) !== instanceKey(owner)) throw new HostServiceError("Notification was not found.", "NOT_FOUND");
    this.#notifications.delete(id);
    this.#publish();
  }

  /** Subscribes to the complete active notification list. */
  subscribe(listener: (notifications: readonly AppNotification[]) => void): () => void {
    this.#listeners.add(listener);
    listener(this.list());
    return () => this.#listeners.delete(listener);
  }

  /** Removes all notifications owned by a closing app instance. */
  closeInstance(owner: AppInstanceOwner): void {
    const key = instanceKey(owner);
    let changed = false;
    for (const [id, notification] of this.#notifications) {
      if (instanceKey(notification.owner) !== key) continue;
      this.#notifications.delete(id);
      changed = true;
    }
    if (changed) this.#publish();
  }

  /** Publishes the current notification list to subscribers. */
  #publish(): void {
    const notifications = this.list();
    for (const listener of this.#listeners) listener(notifications);
  }
}

/** Validates bounded printable text supplied by a hosted app. */
function boundedText(value: string, label: string, max: number, empty = false): void {
  if (typeof value !== "string" || (!empty && value.length === 0) || value.length > max || hasControlCharacters(value)) throw new TypeError(`${label} is invalid.`);
}
