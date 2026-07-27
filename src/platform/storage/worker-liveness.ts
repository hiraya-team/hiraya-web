export type HeartbeatProbe = {
  id: number;
  deadline: number;
  checkedAt: number;
};

export function heartbeatDecision(probe: HeartbeatProbe | null, now: number, intervalMs: number) {
  if (!probe) return "ping" as const;
  if (now - probe.checkedAt > intervalMs * 2) return "ping" as const;
  if (now >= probe.deadline) return "expired" as const;
  return "wait" as const;
}
