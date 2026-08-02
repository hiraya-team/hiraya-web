export type EdgeDirection = "left" | "right" | "up" | "down";

export const EDGE_DWELL_MS = 700;

export type EdgeDwellState = {
  direction: EdgeDirection | null;
  latched: boolean;
  timer: number | null;
};

type EdgeDwellTimers = {
  set: (callback: () => void, delay: number) => number;
  clear: (timer: number) => void;
};

export const browserEdgeDwellTimers: EdgeDwellTimers = {
  set: (callback, delay) => window.setTimeout(callback, delay),
  clear: (timer) => window.clearTimeout(timer),
};

export function updateEdgeDwell(
  state: EdgeDwellState,
  direction: EdgeDirection | null,
  onReady: (direction: EdgeDirection) => void,
  onChange: (direction: EdgeDirection | null) => void,
  timers: EdgeDwellTimers,
) {
  if (direction === null) {
    resetEdgeDwell(state, onChange, timers);
    return;
  }
  if (state.latched || state.direction === direction) return;
  if (state.timer !== null) timers.clear(state.timer);
  state.direction = direction;
  onChange(direction);
  state.timer = timers.set(() => {
    if (state.direction !== direction || state.latched) return;
    state.timer = null;
    state.latched = true;
    onChange(null);
    onReady(direction);
  }, EDGE_DWELL_MS);
}

export function resetEdgeDwell(state: EdgeDwellState, onChange: (direction: EdgeDirection | null) => void, timers: EdgeDwellTimers) {
  if (state.timer !== null) timers.clear(state.timer);
  if (state.direction !== null) onChange(null);
  state.direction = null;
  state.latched = false;
  state.timer = null;
}
