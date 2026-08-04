import {
  APPS_PROTOCOL_VERSION,
  parseRpcRequest,
  parseServiceEventPayload,
  parseServiceResult,
  type AppPermission,
  type RpcRequest,
  type ServiceMethod,
  type ServiceMethods,
  type ServiceEvent,
  type ServiceEvents,
} from "@hiraya-team/apps-contracts";

export type RuntimeHostContext = { close(): void; [group: string]: unknown };
export type RuntimeFileService = {
  stat(params: ServiceMethods["files.stat"]["params"]): unknown;
  read(params: ServiceMethods["files.read"]["params"]): unknown;
  readChunk(params: ServiceMethods["files.readChunk"]["params"]): unknown;
  write(params: ServiceMethods["files.write"]["params"]): unknown;
  beginWrite(params: ServiceMethods["files.beginWrite"]["params"]): unknown;
  writeChunk(params: ServiceMethods["files.writeChunk"]["params"]): unknown;
  commitWrite(params: ServiceMethods["files.commitWrite"]["params"]): unknown;
  abortWrite(params: ServiceMethods["files.abortWrite"]["params"]): unknown;
  resolve(params: ServiceMethods["files.resolve"]["params"]): unknown;
  list(params: ServiceMethods["files.list"]["params"]): unknown;
  createFile(params: ServiceMethods["files.createFile"]["params"]): unknown;
  createFolder(params: ServiceMethods["files.createFolder"]["params"]): unknown;
  rename(params: ServiceMethods["files.rename"]["params"]): unknown;
  move(params: ServiceMethods["files.move"]["params"]): unknown;
  delete(params: ServiceMethods["files.delete"]["params"]): unknown;
  deleteMany(params: ServiceMethods["files.deleteMany"]["params"]): unknown;
  close?(): void;
};

export type RuntimeCommands = {
  set(commands: ServiceMethods["commands.set"]["params"]["commands"]): void | Promise<void>;
  clear(): void | Promise<void>;
  close?(): void;
};

export interface RpcDispatcherOptions {
  permissions: Iterable<AppPermission> | (() => Iterable<AppPermission>);
  host: RuntimeHostContext;
  files: RuntimeFileService;
  commands?: RuntimeCommands;
  maxRequestBytes?: number;
  maxRequestsPerSecond?: number;
  timeoutMs?: number;
  longRunningTimeoutMs?: number;
  timers?: { set(callback: () => void, timeoutMs: number): number; clear(timer: number): void };
}

export const DEFAULT_RPC_TIMEOUT_MS = 15_000;
export const LONG_RUNNING_RPC_TIMEOUT_MS = 120_000;
export const LONG_RUNNING_FILE_MUTATION_METHODS = [
  "files.write", "files.beginWrite", "files.writeChunk", "files.commitWrite", "files.abortWrite",
  "files.createFile", "files.createFolder", "files.rename", "files.move", "files.delete", "files.deleteMany",
] as const satisfies readonly ServiceMethod[];
const longRunningFileMutationMethods = new Set<ServiceMethod>(LONG_RUNNING_FILE_MUTATION_METHODS);
const userInteractionMethods = new Set<ServiceMethod>(["dialogs.openFile", "dialogs.openFolder", "dialogs.saveFile", "dialogs.confirm"]);

export function usesLongRunningRpcDeadline(method: ServiceMethod): boolean {
  return longRunningFileMutationMethods.has(method) || userInteractionMethods.has(method);
}

const METHOD_PERMISSION: Partial<Record<ServiceMethod, AppPermission>> = {
  "files.stat": "files:read", "files.read": "files:read", "files.readChunk": "files:read", "files.resolve": "files:read", "files.list": "files:read",
  "files.write": "files:write", "files.beginWrite": "files:write", "files.writeChunk": "files:write", "files.commitWrite": "files:write", "files.abortWrite": "files:write", "files.createFile": "files:write", "files.createFolder": "files:write", "files.rename": "files:write", "files.move": "files:write", "files.delete": "files:write", "files.deleteMany": "files:write",
  "host.openEntry": "files:read", "host.showEntryActions": "files:read", "host.getEntryStatus": "files:read", "host.getFilePreviewSource": "files:read", "host.setOfflinePinned": "files:read",
  "host.importFiles": "files:write", "host.importFolder": "files:write",
  "dialogs.openFile": "dialogs", "dialogs.openFolder": "dialogs", "dialogs.saveFile": "dialogs", "dialogs.confirm": "dialogs",
  "window.getState": "window", "window.setTitle": "window", "window.setDirty": "window", "window.setSize": "window", "window.setFullscreen": "window", "window.close": "window",
  "commands.set": "commands", "commands.clear": "commands", "notifications.show": "notifications", "notifications.dismiss": "notifications",
  "theme.get": "theme", "storage.get": "storage", "storage.set": "storage", "storage.remove": "storage", "storage.clear": "storage",
};

export class RpcDispatcher {
  readonly #maxRequestBytes: number;
  readonly #maxRequestsPerSecond: number;
  readonly #timeoutMs: number;
  readonly #longRunningTimeoutMs: number;
  readonly #timers: { set(callback: () => void, timeoutMs: number): number; clear(timer: number): void };
  #port: MessagePort | null = null;
  #closed = false;
  #windowStarted = performance.now();
  #windowRequests = 0;

  constructor(private readonly options: RpcDispatcherOptions) {
    this.#maxRequestBytes = options.maxRequestBytes ?? 4 * 1024 * 1024;
    this.#maxRequestsPerSecond = options.maxRequestsPerSecond ?? 60;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
    this.#longRunningTimeoutMs = options.longRunningTimeoutMs ?? LONG_RUNNING_RPC_TIMEOUT_MS;
    this.#timers = options.timers ?? {
      set: (callback, timeoutMs) => setTimeout(callback, timeoutMs) as unknown as number,
      clear: (timer) => clearTimeout(timer),
    };
    if (![this.#maxRequestBytes, this.#maxRequestsPerSecond, this.#timeoutMs, this.#longRunningTimeoutMs].every((value) => Number.isFinite(value) && value > 0) || this.#longRunningTimeoutMs < this.#timeoutMs || this.#longRunningTimeoutMs > LONG_RUNNING_RPC_TIMEOUT_MS) throw new TypeError("RPC limits must be positive, ordered, and within the host cap.");
  }

  attach(port: MessagePort): void {
    if (this.#closed || this.#port) throw new Error("RPC dispatcher can only attach one channel.");
    this.#port = port;
    port.addEventListener("message", this.#onMessage);
    port.addEventListener("messageerror", this.#onMessageError);
    port.start();
  }

  detach(): void {
    if (!this.#port) return;
    this.#port.removeEventListener("message", this.#onMessage);
    this.#port.removeEventListener("messageerror", this.#onMessageError);
    this.#port.close();
    this.#port = null;
  }

  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.detach();
    this.options.commands?.close?.();
    this.options.files.close?.();
    this.options.host.close();
  }

  emit<E extends ServiceEvent>(event: E, payload: ServiceEvents[E]): void {
    const parsed = parseServiceEventPayload(event, payload);
    this.#post({ protocolVersion: APPS_PROTOCOL_VERSION, type: "event", event, payload: parsed });
  }

  async dispatch(value: unknown): Promise<void> {
    let request: RpcRequest | null = null;
    try {
      if (estimateBytes(value) > this.#maxRequestBytes) throw rpcError("INVALID_REQUEST", "The request exceeds the size limit.");
      this.#takeRateToken();
      request = parseRpcRequest(value);
      const permission = METHOD_PERMISSION[request.method];
      const permissions = typeof this.options.permissions === "function" ? this.options.permissions() : this.options.permissions;
      if (permission && !new Set(permissions).has(permission)) throw rpcError("PERMISSION_DENIED", "The app does not have permission for this operation.");
      const timeoutMs = usesLongRunningRpcDeadline(request.method) ? this.#longRunningTimeoutMs : this.#timeoutMs;
      const result = await withTimeout(this.#invoke(request), timeoutMs, hasSideEffects(request.method), this.#timers);
      const parsed = parseServiceResult(request.method, result);
      const transfer = request.method === "files.read" || request.method === "files.readChunk" ? [(parsed as { data: ArrayBuffer }).data] : [];
      this.#post({ protocolVersion: APPS_PROTOCOL_VERSION, type: "response", id: request.id, ok: true, result: parsed }, transfer);
    } catch (error) {
      const id = request?.id ?? requestId(value);
      if (id) this.#post({ protocolVersion: APPS_PROTOCOL_VERSION, type: "response", id, ok: false, error: sanitizeError(error) });
    }
  }

  #invoke(request: RpcRequest): unknown {
    const [group, name] = request.method.split(".");
    if (group === "files") {
      const method = this.options.files[name as keyof RuntimeFileService];
      if (typeof method !== "function") throw rpcError("METHOD_NOT_FOUND", "The requested method is not available.");
      return method.call(this.options.files, request.params as never);
    }
    if (group === "commands") {
      if (!this.options.commands) throw rpcError("UNAVAILABLE", "App commands are not supported by this host.");
      return name === "set" ? this.options.commands.set((request.params as ServiceMethods["commands.set"]["params"]).commands) : this.options.commands.clear();
    }
    const api = this.options.host[group] as object | undefined;
    const method = api ? (api as Record<string, unknown>)[name] as ((...args: unknown[]) => unknown) | undefined : undefined;
    if (!method) throw rpcError("METHOD_NOT_FOUND", "The requested method is not available.");
    const params = request.params as Record<string, unknown>;
    if (Object.keys(params).length === 0) return method.call(api);
    if (group === "window" && name === "setTitle") return method.call(api, params.title);
    if (group === "window" && name === "setDirty") return method.call(api, params.dirty);
    if (group === "window" && name === "setSize") return method.call(api, params.width, params.height);
    if (group === "window" && name === "setFullscreen") return method.call(api, params.fullscreen);
    if (group === "notifications" && name === "dismiss") return method.call(api, params.id);
    if (group === "storage" && name === "get" || group === "storage" && name === "remove") return method.call(api, params.key);
    if (group === "storage" && name === "set") return method.call(api, params.key, params.value);
    return method.call(api, params);
  }

  #takeRateToken(): void {
    const now = performance.now();
    if (now - this.#windowStarted >= 1_000) { this.#windowStarted = now; this.#windowRequests = 0; }
    if (++this.#windowRequests > this.#maxRequestsPerSecond) throw rpcError("QUOTA_EXCEEDED", "The app is sending requests too quickly.");
  }

  #post(value: unknown, transfer: Transferable[] = []): void {
    if (!this.#closed) this.#port?.postMessage(value, transfer);
  }

  readonly #onMessage = (event: MessageEvent<unknown>) => { void this.dispatch(event.data); };
  readonly #onMessageError = () => this.dispose();
}

function rpcError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function sanitizeError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && ["INVALID_REQUEST", "METHOD_NOT_FOUND", "PERMISSION_DENIED", "NOT_FOUND", "ALREADY_EXISTS", "CONFLICT", "CANCELLED", "OFFLINE", "QUOTA_EXCEEDED", "TIMEOUT", "UNAVAILABLE", "INTERNAL"].includes(error.code) ? error.code : error instanceof TypeError ? "INVALID_REQUEST" : "INTERNAL";
  const safe = code === "INTERNAL" ? "The app request could not be completed." : error instanceof Error ? error.message.slice(0, 1_000) : "The app request could not be completed.";
  return { code, message: safe };
}

function requestId(value: unknown): string | null {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string" && value.id.length <= 256 ? value.id : null;
}

function estimateBytes(value: unknown, seen = new Set<object>()): number {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof value === "string") return value.length * 2;
  if (value === null || typeof value !== "object") return 8;
  if (seen.has(value)) return Number.POSITIVE_INFINITY;
  seen.add(value);
  let size = 0;
  for (const [key, item] of Object.entries(value)) size += key.length * 2 + estimateBytes(item, seen);
  return size;
}

async function withTimeout<T>(operation: T | Promise<T>, timeoutMs: number, sideEffecting: boolean, timers: { set(callback: () => void, timeoutMs: number): number; clear(timer: number): void }): Promise<T> {
  let timer = 0;
  try {
    return await Promise.race([Promise.resolve(operation), new Promise<never>((_, reject) => { timer = timers.set(() => reject(rpcError(sideEffecting ? "INTERNAL" : "TIMEOUT", sideEffecting ? "The request deadline expired after the operation started; its outcome may be unknown." : "The app request timed out.")), timeoutMs); })]);
  } finally { timers.clear(timer); }
}

function hasSideEffects(method: ServiceMethod): boolean {
  return !new Set<ServiceMethod>([
    "app.getLaunchContext", "app.getCapabilities", "files.stat", "files.read", "files.readChunk", "files.resolve", "files.list",
    "host.getEntryStatus", "host.getFilePreviewSource", "dialogs.openFile", "dialogs.openFolder", "dialogs.saveFile", "dialogs.confirm", "window.getState", "theme.get", "storage.get",
  ]).has(method);
}
