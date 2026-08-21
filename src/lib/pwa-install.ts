export type InstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
export type PwaInstallState = "standalone" | "installed" | "promptable" | "guidance";

/** Reports whether the app is running in standalone mode. */
export function isStandalone(displayMode = globalThis.matchMedia?.("(display-mode: standalone)").matches ?? false, navigatorStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true) {
  return displayMode || navigatorStandalone;
}

/** Returns PWA install state. */
export function pwaInstallState(prompt: InstallPromptEvent | null, installed: boolean, standalone: boolean): PwaInstallState {
  if (standalone) return "standalone";
  if (installed) return "installed";
  return prompt ? "promptable" : "guidance";
}

/** Updates activation blocked. */
export async function updateActivationBlocked(dirtyFiles: readonly boolean[], locks: LockManager | undefined = navigator.locks) {
  if (dirtyFiles.some(Boolean)) return true;
  if (!locks) return false;
  const state = await locks.query();
  return (state.held?.length ?? 0) > 0 || (state.pending?.length ?? 0) > 0;
}
