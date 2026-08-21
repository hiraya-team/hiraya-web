export type RunningPackageInstance = Readonly<{ id: string; kind: string; package?: { manifest: { id: string } } }>;

/** Closes an app after confirming any unsaved changes may be discarded. */
export async function closeWithDirtyCheck(options: {
  dirty: boolean;
  confirmDiscard(): boolean | Promise<boolean>;
  close(): void;
}): Promise<boolean> {
  if (options.dirty && !await options.confirmDiscard()) return false;
  options.close();
  return true;
}

/** Force-closes every running sandbox instance owned by an app. */
export function forceCloseRunningAppInstances(
  instances: readonly RunningPackageInstance[],
  appId: string,
  close: (instanceId: string) => void,
): string[] {
  const ids = instances
    .filter((instance) => instance.kind === "sandbox" && instance.package?.manifest.id === appId)
    .map((instance) => instance.id);
  for (const id of ids) close(id);
  return ids;
}
