import type { DesktopEntry, DesktopIconGroup, DesktopWidget } from "../types";

export type DesktopEntity =
  | { id: `entry:${string}`; kind: "entry"; entry: DesktopEntry; x: number; y: number; width: number; height: number }
  | { id: `widget:${string}`; kind: "widget"; widget: DesktopWidget; x: number; y: number; width: number; height: number }
  | { id: `group:${string}`; kind: "group"; group: DesktopIconGroup; entry: DesktopEntry; x: number; y: number; width: number; height: number };

export type DesktopEntityTransform = { entityId: string; delta: { x: number; y: number } };

export const entryEntityId = (id: string): `entry:${string}` => `entry:${id}`;
export const widgetEntityId = (id: string): `widget:${string}` => `widget:${id}`;
export const groupEntityId = (id: string): `group:${string}` => `group:${id}`;

export function desktopEntityParts(id: string) {
  const separator = id.indexOf(":");
  if (separator < 1) return null;
  const kind = id.slice(0, separator);
  if (kind !== "entry" && kind !== "widget" && kind !== "group") return null;
  return { kind, sourceId: id.slice(separator + 1) } as const;
}

export function desktopEntities(entries: readonly DesktopEntry[], widgets: readonly DesktopWidget[], groups: readonly DesktopIconGroup[], iconSize: { width: number; height: number }) {
  const grouped = new Map(groups.map((group) => [group.folderId, group]));
  return [
    ...entries.flatMap<DesktopEntity>((entry) => entry.parentId !== null ? [] : grouped.has(entry.id)
      ? [{ id: groupEntityId(entry.id), kind: "group", group: grouped.get(entry.id)!, entry, ...entry.position, width: grouped.get(entry.id)!.width, height: grouped.get(entry.id)!.height }]
      : [{ id: entryEntityId(entry.id), kind: "entry", entry, ...entry.position, ...iconSize }]),
    ...widgets.map<DesktopEntity>((widget) => ({ ...widget, id: widgetEntityId(widget.id), kind: "widget", widget })),
  ];
}

export function desktopEntityMovementPlan(entities: readonly { id: DesktopEntity["id"]; kind: DesktopEntity["kind"]; x: number; y: number }[], selectedIds: ReadonlySet<string>, anchorId: string, position: { x: number; y: number }) {
  const anchor = entities.find((entity) => entity.id === anchorId);
  if (!anchor || !selectedIds.has(anchorId)) return null;
  const delta = { x: position.x - anchor.x, y: position.y - anchor.y };
  return {
    delta,
    moves: entities.filter((entity) => selectedIds.has(entity.id)).map((entity) => ({ id: entity.id, kind: entity.kind, position: { x: entity.x + delta.x, y: entity.y + delta.y } })),
  };
}

export function desktopSelectionCanDropIntoFolder(entities: readonly Pick<DesktopEntity, "id" | "kind">[], selectedIds: ReadonlySet<string>) {
  const selected = entities.filter((entity) => selectedIds.has(entity.id));
  return selected.length > 0 && selected.every((entity) => entity.kind === "entry");
}

export function retainedDesktopEntityIds(entities: readonly Pick<DesktopEntity, "id">[], selectedIds: readonly string[]) {
  const available = new Set(entities.map((entity) => entity.id));
  return new Set(selectedIds.filter((id) => available.has(id as DesktopEntity["id"])));
}

export function spatialEntityId(entities: readonly { id: string; x: number; y: number; width: number; height: number }[], currentId: string, key: string) {
  const ordered = [...entities].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  if (key === "Home") return ordered[0]?.id;
  if (key === "End") return ordered.at(-1)?.id;
  const current = entities.find((entity) => entity.id === currentId);
  if (!current) return undefined;
  const center = { x: current.x + current.width / 2, y: current.y + current.height / 2 };
  return entities
    .filter((entity) => entity.id !== currentId)
    .map((entity) => {
      const dx = entity.x + entity.width / 2 - center.x;
      const dy = entity.y + entity.height / 2 - center.y;
      return { entity, dx, dy, distance: Math.hypot(dx, dy) };
    })
    .filter(({ dx, dy }) => key === "ArrowLeft" ? dx < 0 && Math.abs(dx) >= Math.abs(dy) : key === "ArrowRight" ? dx > 0 && dx >= Math.abs(dy) : key === "ArrowUp" ? dy < 0 && Math.abs(dy) >= Math.abs(dx) : dy > 0 && dy >= Math.abs(dx))
    .sort((a, b) => a.distance - b.distance)[0]?.entity.id;
}

export function focusSpatialDesktopEntity(current: HTMLElement, key: string) {
  const desktop = current.closest<HTMLElement>(".desktop");
  const currentEntity = current.closest<HTMLElement>("[data-desktop-entity-id]");
  if (!desktop || !currentEntity?.dataset.desktopEntityId) return false;
  const desktopBounds = desktop.getBoundingClientRect();
  const elements = Array.from(desktop.querySelectorAll<HTMLElement>("[data-desktop-entity-id]"))
    .filter((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.right > desktopBounds.left && bounds.left < desktopBounds.right && bounds.bottom > desktopBounds.top && bounds.top < desktopBounds.bottom;
    });
  const targetId = spatialEntityId(elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { id: element.dataset.desktopEntityId!, x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
  }), currentEntity.dataset.desktopEntityId, key);
  const target = elements.find((element) => element.dataset.desktopEntityId === targetId);
  const focusTarget = target?.matches("button") ? target : target?.querySelector<HTMLElement>(".shell-item__drag, .shell-item__widget-drag");
  focusTarget?.focus();
  focusTarget?.click();
  return Boolean(focusTarget);
}
