export const QUIT_BACK_WINDOW_MS = 3_000;

export type QuitBackState = { count: number; lastAt: number };

export function nextQuitBack(state: QuitBackState, now: number) {
  const count = now - state.lastAt <= QUIT_BACK_WINDOW_MS ? state.count + 1 : 1;
  return {
    state: { count, lastAt: now },
    quit: count >= 3,
    message: count === 1 ? "Press Back twice more to quit Hiraya." : count === 2 ? "Press Back once more to quit Hiraya." : "",
  };
}
