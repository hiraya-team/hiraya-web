/// <reference lib="webworker" />

import type { StorageDbRequest, StorageDbResponse } from "./opfs-db-protocol";
import { heartbeatDecision, type HeartbeatProbe } from "../platform/storage/worker-liveness";

const ENGINE_TIMEOUT_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 2_000;
const pending = new Map<number, { port: MessagePort; requestId: number }>();
const queued: Array<{ port: MessagePort; request: StorageDbRequest }> = [];
const clients = new Set<MessagePort>();
let engineRequestId = 0;
let engine: MessagePort | null = null;
let hostRequested = false;
let hostRequestId = 0;
let hostRequestedAt = 0;
let hostCandidate: MessagePort | null = null;
let heartbeat: HeartbeatProbe | null = null;
let engineHost: MessagePort | null = null;

function requestHost(candidate?: MessagePort) {
  if (engine) return;
  if (!hostRequested) {
    hostRequested = true;
    hostRequestId += 1;
    hostRequestedAt = performance.now();
  }
  if (candidate) {
    hostCandidate = candidate;
    candidate.postMessage({ type: "need-engine", requestId: hostRequestId });
    return;
  }
  const candidates = [...clients];
  const next = candidates[(candidates.indexOf(hostCandidate!) + 1) % candidates.length];
  if (next) {
    hostCandidate = next;
    next.postMessage({ type: "need-engine", requestId: hostRequestId });
  }
}

function loseEngine(message: string) {
  const previousHost = engineHost;
  const previousRequestId = hostRequestId;
  engine?.close();
  engine = null;
  engineHost = null;
  heartbeat = null;
  hostRequested = false;
  hostRequestedAt = 0;
  for (const destination of pending.values()) {
    destination.port.postMessage({ id: destination.requestId, error: message });
  }
  pending.clear();
  previousHost?.postMessage({ type: "terminate-engine", requestId: previousRequestId });
  setTimeout(requestHost, 0);
}

function failEngine(message: string) {
  hostRequested = false;
  hostRequestedAt = 0;
  for (const item of queued.splice(0)) item.port.postMessage({ id: item.request.id, error: message });
}

function handleEngineMessage(event: MessageEvent<StorageDbResponse>) {
  if (event.data.id === heartbeat?.id) {
    heartbeat = null;
    return;
  }
  const destination = pending.get(event.data.id);
  if (!destination) return;
  pending.delete(event.data.id);
  destination.port.postMessage({ ...event.data, id: destination.requestId });
}

function forward(port: MessagePort, request: StorageDbRequest) {
  if (!engine) {
    queued.push({ port, request });
    requestHost();
    return;
  }
  const id = ++engineRequestId;
  pending.set(id, { port, requestId: request.id });
  engine.postMessage({ ...request, id });
}

const scope = self as typeof self & {
  onconnect: ((event: MessageEvent & { ports: MessagePort[] }) => void) | null;
};

scope.onconnect = (event) => {
  const port = event.ports[0];
  clients.add(port);
  let storageNamespace = "";
  port.onmessage = (message: MessageEvent<StorageDbRequest | { type: "configure-storage"; storage: string } | { type: "attach-engine"; requestId: number; port: MessagePort } | { type: "engine-failed"; requestId: number; error: string } | { type: "release-engine"; requestId: number } | { type: "reset-engine" }>) => {
    if ("type" in message.data && message.data.type === "configure-storage") {
      if (!/^[a-f\d]{64}$/.test(message.data.storage)) throw new Error("The shared storage worker has no valid storage namespace.");
      if (storageNamespace && storageNamespace !== message.data.storage) throw new Error("The shared storage worker storage namespace cannot change.");
      storageNamespace = message.data.storage;
      return;
    }
    if ("type" in message.data && message.data.type === "attach-engine") {
      if (engine || message.data.requestId !== hostRequestId) {
        message.data.port.close();
        return;
      }
      engine = message.data.port;
      engineHost = port;
      hostRequested = false;
      hostRequestedAt = 0;
      heartbeat = null;
      engine.onmessage = handleEngineMessage;
      engine.start();
      for (const item of queued.splice(0)) forward(item.port, item.request);
      return;
    }
    if ("type" in message.data && message.data.type === "engine-failed") {
      if (!engine && message.data.requestId === hostRequestId) failEngine(message.data.error);
      return;
    }
    if ("type" in message.data && message.data.type === "release-engine") {
      if (engineHost === port && message.data.requestId === hostRequestId) loseEngine("The local database owner changed. Retry the operation.");
      return;
    }
    if ("type" in message.data && message.data.type === "reset-engine") {
      loseEngine("The local database owner changed. Retry the operation.");
      return;
    }
    forward(port, message.data as StorageDbRequest);
  };
  port.start();
  requestHost(port);
};

setInterval(() => {
  const now = performance.now();
  if (!engine) {
    if (hostRequested && now - hostRequestedAt > ENGINE_TIMEOUT_MS) {
      hostRequested = false;
      hostRequestId += 1;
    }
    requestHost();
    return;
  }
  const decision = heartbeatDecision(heartbeat, now, HEARTBEAT_INTERVAL_MS);
  if (decision === "expired") {
    loseEngine("The local database owner changed. Retry the operation.");
    return;
  }
  if (decision === "wait") {
    heartbeat!.checkedAt = now;
    return;
  }
  const id = ++engineRequestId;
  heartbeat = { id, checkedAt: now, deadline: now + ENGINE_TIMEOUT_MS };
  engine.postMessage({ id, desktopId: null, method: "ping", params: undefined });
}, HEARTBEAT_INTERVAL_MS);
