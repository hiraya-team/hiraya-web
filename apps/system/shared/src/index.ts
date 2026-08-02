import { connectHiraya, HirayaSdkError, type FileHandle, type FolderHandle, type HirayaClient, type LaunchContext } from "@hiraya/apps-sdk";

export interface ConnectedApp {
  hiraya: HirayaClient;
  launch: LaunchContext;
  onDispose(cleanup: () => void): () => void;
  dispose(): void;
}

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

export function relativeReader(hiraya: HirayaClient): (from: FileHandle | FolderHandle, path: string) => Promise<{ data: ArrayBuffer; mimeType: string }> {
  return async (from, path) => {
    const entry = await hiraya.files.resolve(from, path);
    if (entry.kind !== "file") throw new TypeError("The relative path does not reference a file.");
    return { data: (await hiraya.files.readAll(entry.metadata.handle)).data, mimeType: entry.metadata.mimeType };
  };
}

export function describeError(error: unknown, fallback: string): string {
  if (error instanceof HirayaSdkError) return error.code === "CANCELLED" ? "" : `${fallback} ${error.message} (${error.code})`;
  return error instanceof Error ? `${fallback} ${error.message}` : fallback;
}

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

export function setAppLoading(surface: HTMLElement, content: HTMLElement, loading: HTMLElement, message?: string): void {
  const busy = message !== undefined;
  surface.setAttribute("aria-busy", String(busy));
  loading.hidden = !busy;
  content.inert = busy;
  content.toggleAttribute("aria-hidden", busy);
  const title = loading.querySelector<HTMLElement>('[slot="title"]');
  if (title && message) title.textContent = message;
}

export class LatestOperation {
  #generation = 0;

  begin(): number { return ++this.#generation; }
  isLatest(generation: number): boolean { return generation === this.#generation; }
  invalidate(): void { this.#generation += 1; }
}

export function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}
