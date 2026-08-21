import { connectHiraya, HirayaSdkError, type FileHandle, type FolderHandle, type HirayaClient, type LaunchContext } from "@hiraya-team/apps-sdk";

/** Names custom item-list events consumed by sandboxed system apps. */
export const ITEM_LIST_EVENTS = {
  select: "hiraya-item-select",
  activate: "hiraya-item-activate",
  context: "hiraya-item-context",
  reorder: "hiraya-item-reorder",
} as const;

export interface ConnectedApp {
  hiraya: HirayaClient;
  launch: LaunchContext;
  onDispose(cleanup: () => void): () => void;
  dispose(): void;
}

/** Connects system app. */
export async function connectSystemApp(appId: string): Promise<ConnectedApp> {
  document.body.classList.add("hiraya-app");
  const hiraya = await connectHiraya({ appId });
  try {
    const launch = await hiraya.app.getLaunchContext();
    const cleanups = new Set<() => void>();
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups) cleanup();
      cleanups.clear();
      hiraya.close();
    };
    addEventListener("pagehide", dispose, { once: true });
    return { hiraya, launch, onDispose: (cleanup) => { cleanups.add(cleanup); return () => cleanups.delete(cleanup); }, dispose };
  } catch (error) {
    hiraya.close();
    throw error;
  }
}

/** Creates a reader for files relative to an entry handle. */
export function relativeReader(hiraya: HirayaClient): (from: FileHandle | FolderHandle, path: string) => Promise<{ data: ArrayBuffer; mimeType: string }> {
  return async (from, path) => {
    const entry = await hiraya.files.resolve(from, path);
    if (entry.kind !== "file") throw new TypeError("The relative path does not reference a file.");
    return { data: (await hiraya.files.readAll(entry.metadata.handle)).data, mimeType: entry.metadata.mimeType };
  };
}

/** Formats an SDK or application error for display. */
export function describeError(error: unknown, fallback: string): string {
  if (error instanceof HirayaSdkError) return error.code === "CANCELLED" ? "" : `${fallback} ${error.message} (${error.code})`;
  return error instanceof Error ? `${fallback} ${error.message}` : fallback;
}

/** Formats bytes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

/** Sets app loading. */
export function setAppLoading(surface: HTMLElement, content: HTMLElement, loading: HTMLElement, message?: string): void {
  const busy = message !== undefined;
  surface.setAttribute("aria-busy", String(busy));
  loading.hidden = !busy;
  content.inert = busy;
  content.toggleAttribute("aria-hidden", busy);
  const title = loading.querySelector<HTMLElement>('[slot="title"]');
  if (title && message) title.textContent = message;
}

/** Implements the latest operation. */
export class LatestOperation {
  #generation = 0;

  /** Starts an operation and returns its generation. */
  begin(): number { return ++this.#generation; }
  /** Reports whether a generation is the latest. */
  isLatest(generation: number): boolean { return generation === this.#generation; }
  /** Invalidates the current operation generation. */
  invalidate(): void { this.#generation += 1; }
}

/** Returns a required document element. */
export function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}
