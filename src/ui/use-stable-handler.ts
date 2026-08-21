import { useCallback, useRef } from "react";

/** Returns a stable callback that always invokes the latest handler. */
export function useStableHandler<Args extends unknown[], Result>(handler: (...args: Args) => Result) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  return useCallback((...args: Args) => handlerRef.current(...args), []);
}
