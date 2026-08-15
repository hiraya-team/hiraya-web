import type { AppBackRequestResult, WindowState } from "@hiraya-team/apps-contracts";
import { hasControlCharacters, HostServiceError, instanceKey, unavailable, type AppInstanceOwner } from "./types";

export const MAX_APP_WINDOW_TITLE_LENGTH = 120;
export const DEFAULT_APP_HANDLER_DEADLINE_MS = 2_000;

export type AppWindowSnapshot = WindowState & {
  title: string;
  dirty: boolean;
};

export type BeforeCloseHandler = (signal: AbortSignal) => boolean | void | Promise<boolean | void>;
export type SaveHandler = (signal: AbortSignal) => void | Promise<void>;
export type AppWindowListener = (owner: AppInstanceOwner, state: AppWindowSnapshot) => void;
export type AppBackRequestOutcome = "unsupported" | "handled" | "home" | "failed";

type PendingBackRequest = {
  id: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: (outcome: AppBackRequestOutcome) => void;
};

type InstanceRecord = {
  owner: AppInstanceOwner;
  state: AppWindowSnapshot;
  beforeClose?: BeforeCloseHandler;
  save?: SaveHandler;
  backHandler: boolean;
  backRequest?: PendingBackRequest;
  pending: Set<AbortController>;
};

export interface AppWindowApi {
  getState(): Promise<WindowState>;
  setTitle(title: string): Promise<void>;
  setDirty(dirty: boolean): Promise<void>;
  setSize(width: number, height: number): Promise<WindowState>;
  setFullscreen(fullscreen: boolean): Promise<WindowState>;
  close(): Promise<void>;
  requestSave(): Promise<boolean>;
  onBeforeClose(handler: BeforeCloseHandler | undefined): void;
  onSave(handler: SaveHandler | undefined): void;
}

export class AppLifecycleService {
  readonly #instances = new Map<string, InstanceRecord>();
  readonly #listeners = new Set<AppWindowListener>();

  constructor(
    private readonly handlerDeadlineMs = DEFAULT_APP_HANDLER_DEADLINE_MS,
    private readonly onCloseRequest?: (owner: AppInstanceOwner) => boolean | void | Promise<boolean | void>,
  ) {
    if (!Number.isFinite(handlerDeadlineMs) || handlerDeadlineMs <= 0) throw new TypeError("Handler deadline must be positive.");
  }

  open(owner: AppInstanceOwner, initial: WindowState, title: string): AppWindowApi {
    const key = instanceKey(owner);
    if (this.#instances.has(key)) throw new HostServiceError(`App instance ${owner.instanceId} is already open.`, "ALREADY_EXISTS");
    validateTitle(title);
    validateWindowState(initial);
    this.#instances.set(key, { owner, state: { ...initial, title, dirty: false }, backHandler: false, pending: new Set() });
    return {
      getState: async () => this.getState(owner),
      setTitle: async (nextTitle) => this.setTitle(owner, nextTitle),
      setDirty: async (dirty) => this.setDirty(owner, dirty),
      setSize: async (width, height) => this.setSize(owner, width, height),
      setFullscreen: async (fullscreen) => this.setFullscreen(owner, fullscreen),
      close: async () => { await this.requestClose(owner); },
      requestSave: () => this.requestSave(owner),
      onBeforeClose: (handler) => this.setBeforeCloseHandler(owner, handler),
      onSave: (handler) => this.setSaveHandler(owner, handler),
    };
  }

  snapshot(owner: AppInstanceOwner): AppWindowSnapshot {
    return { ...this.#record(owner).state };
  }

  getState(owner: AppInstanceOwner): WindowState {
    const { focused, maximized, fullscreen, width, height } = this.#record(owner).state;
    return { focused, maximized, fullscreen, width, height };
  }

  setHostState(owner: AppInstanceOwner, state: Partial<WindowState>): void {
    const record = this.#record(owner);
    const next = { ...record.state, ...state };
    validateWindowState(next);
    record.state = next;
    this.#publish(record);
  }

  setTitle(owner: AppInstanceOwner, title: string): void {
    validateTitle(title);
    const record = this.#record(owner);
    record.state = { ...record.state, title };
    this.#publish(record);
  }

  setDirty(owner: AppInstanceOwner, dirty: boolean): void {
    if (typeof dirty !== "boolean") throw new TypeError("Dirty state must be boolean.");
    const record = this.#record(owner);
    record.state = { ...record.state, dirty };
    this.#publish(record);
  }

  setSize(owner: AppInstanceOwner, width: number, height: number): WindowState {
    validateDimension(width, "width");
    validateDimension(height, "height");
    const record = this.#record(owner);
    record.state = { ...record.state, width, height };
    this.#publish(record);
    return this.getState(owner);
  }

  setFullscreen(owner: AppInstanceOwner, fullscreen: boolean): WindowState {
    if (typeof fullscreen !== "boolean") throw new TypeError("Fullscreen state must be boolean.");
    const record = this.#record(owner);
    record.state = { ...record.state, fullscreen };
    this.#publish(record);
    return this.getState(owner);
  }

  setBeforeCloseHandler(owner: AppInstanceOwner, handler: BeforeCloseHandler | undefined): void {
    this.#record(owner).beforeClose = handler;
  }

  setSaveHandler(owner: AppInstanceOwner, handler: SaveHandler | undefined): void {
    this.#record(owner).save = handler;
  }

  setBackHandler(owner: AppInstanceOwner, enabled: boolean): void {
    if (typeof enabled !== "boolean") throw new TypeError("Back handler state must be boolean.");
    const record = this.#record(owner);
    record.backHandler = enabled;
    if (!enabled) this.#finishBackRequest(record, "unsupported");
  }

  requestBack(owner: AppInstanceOwner, emit: (requestId: string) => void): Promise<AppBackRequestOutcome> {
    const record = this.#record(owner);
    if (!record.backHandler || record.backRequest) return Promise.resolve("unsupported");
    const id = crypto.randomUUID();
    const result = new Promise<AppBackRequestOutcome>((resolve) => {
      record.backRequest = {
        id,
        resolve,
        timer: setTimeout(() => this.#finishBackRequest(record, "failed"), this.handlerDeadlineMs),
      };
    });
    try {
      emit(id);
    } catch {
      this.#finishBackRequest(record, "failed");
    }
    return result;
  }

  resolveBackRequest(owner: AppInstanceOwner, requestId: string, result: AppBackRequestResult): void {
    if (result !== "handled" && result !== "home" && result !== "failed") throw new TypeError("Back request result is invalid.");
    const record = this.#record(owner);
    if (record.backRequest?.id !== requestId) throw new HostServiceError("The Back request is not pending for this app instance.", "NOT_FOUND");
    this.#finishBackRequest(record, result);
  }

  async requestClose(owner: AppInstanceOwner): Promise<boolean> {
    const record = this.#record(owner);
    if (record.beforeClose && await this.#runWithDeadline(record, record.beforeClose) === false) return false;
    if (await this.onCloseRequest?.(owner) === false) return false;
    return true;
  }

  async requestSave(owner: AppInstanceOwner): Promise<boolean> {
    const record = this.#record(owner);
    if (!record.save) return false;
    await this.#runWithDeadline(record, record.save);
    return true;
  }

  subscribe(listener: AppWindowListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  closeInstance(owner: AppInstanceOwner): void {
    const key = instanceKey(owner);
    const record = this.#instances.get(key);
    if (!record) return;
    this.#instances.delete(key);
    this.#finishBackRequest(record, "unsupported");
    for (const controller of record.pending) controller.abort(unavailable(owner));
    record.pending.clear();
  }

  #record(owner: AppInstanceOwner): InstanceRecord {
    return this.#instances.get(instanceKey(owner)) ?? (() => { throw unavailable(owner); })();
  }

  #publish(record: InstanceRecord): void {
    const state = { ...record.state };
    for (const listener of this.#listeners) listener(record.owner, state);
  }

  #finishBackRequest(record: InstanceRecord, outcome: AppBackRequestOutcome): void {
    const request = record.backRequest;
    if (!request) return;
    record.backRequest = undefined;
    clearTimeout(request.timer);
    request.resolve(outcome);
  }

  async #runWithDeadline<T>(record: InstanceRecord, handler: (signal: AbortSignal) => T | Promise<T>): Promise<T> {
    const controller = new AbortController();
    record.pending.add(controller);
    const timer = setTimeout(() => controller.abort(new HostServiceError("App handler exceeded its deadline.", "TIMEOUT")), this.handlerDeadlineMs);
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    });
    try {
      return await Promise.race([Promise.resolve().then(() => handler(controller.signal)), aborted]);
    } finally {
      clearTimeout(timer);
      record.pending.delete(controller);
    }
  }
}

function validateTitle(title: string): void {
  if (typeof title !== "string" || title.length === 0 || title.length > MAX_APP_WINDOW_TITLE_LENGTH || hasControlCharacters(title)) {
    throw new TypeError(`Window title must contain 1-${MAX_APP_WINDOW_TITLE_LENGTH} printable characters.`);
  }
}

function validateDimension(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0 || value > 16_384) throw new TypeError(`Window ${label} is invalid.`);
}

function validateWindowState(state: WindowState): void {
  validateDimension(state.width, "width");
  validateDimension(state.height, "height");
  if (typeof state.focused !== "boolean" || typeof state.maximized !== "boolean" || typeof state.fullscreen !== "boolean") {
    throw new TypeError("Window state is invalid.");
  }
}
