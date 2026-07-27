export type EdgeEntryLatch = { inside: boolean };

export function enteredEdge<T>(latch: EdgeEntryLatch, edge: T | null) {
  if (edge === null) {
    latch.inside = false;
    return null;
  }
  if (latch.inside) return null;
  latch.inside = true;
  return edge;
}
