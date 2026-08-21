import { useCallback, useRef, useState } from "react";
import type { RunningApp } from "./model";

export type RunningAppUpdate = RunningApp[] | ((current: RunningApp[]) => RunningApp[]);

/** Owns running-window state, focus order, and immutable updates. */
export function useRunningWindows() {
  const [runningApps, setRunningApps] = useState<RunningApp[]>([]);
  const runningAppsRef = useRef<RunningApp[]>([]);
  const [focusedAppId, setFocusedAppId] = useState<string | null>(null);
  const focusedAppIdRef = useRef<string | null>(null);
  const nextWindowZRef = useRef(1);

  const updateRunningApps = useCallback((update: RunningAppUpdate) => {
    if (Array.isArray(update)) {
      runningAppsRef.current = update;
      setRunningApps(update);
      return;
    }
    setRunningApps((current) => {
      const next = update(current);
      runningAppsRef.current = next;
      return next;
    });
  }, []);

  const setFocusedApp = useCallback((id: string | null) => {
    focusedAppIdRef.current = id;
    setFocusedAppId(id);
  }, []);

  const nextWindowZIndex = useCallback(() => {
    nextWindowZRef.current += 1;
    return nextWindowZRef.current;
  }, []);

  const setNextWindowZIndex = useCallback((value: number) => {
    nextWindowZRef.current = value;
  }, []);

  return {
    runningApps,
    runningAppsRef,
    focusedAppId,
    focusedAppIdRef,
    updateRunningApps,
    setFocusedApp,
    nextWindowZIndex,
    setNextWindowZIndex,
  };
}
