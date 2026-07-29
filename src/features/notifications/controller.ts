export function nextUnreadNotificationIds(current: ReadonlySet<string>, known: ReadonlySet<string>, active: ReadonlySet<string>, open: boolean) {
  if (open) return new Set<string>();
  const next = new Set([...current].filter((id) => active.has(id)));
  for (const id of active) if (!known.has(id)) next.add(id);
  return next;
}

export function nextNotificationOrder(current: readonly string[], active: readonly string[]) {
  const activeIds = new Set(active);
  const retained = current.filter((id) => activeIds.has(id));
  const knownIds = new Set(retained);
  const added = active.filter((id) => !knownIds.has(id)).reverse();
  const next = [...added, ...retained];
  return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
}
