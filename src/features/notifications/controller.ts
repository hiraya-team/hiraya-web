export function nextUnreadNotificationIds(current: ReadonlySet<string>, known: ReadonlySet<string>, active: ReadonlySet<string>, open: boolean) {
  if (open) return new Set<string>();
  const next = new Set([...current].filter((id) => active.has(id)));
  for (const id of active) if (!known.has(id)) next.add(id);
  return next;
}
