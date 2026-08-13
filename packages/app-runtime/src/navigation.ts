type SandboxNavigationOptions = {
  onNavigation?(): void;
  onPointer?(observation: SandboxPointerObservation): void;
  onReady?(): void;
  replacement?(): Node;
};

export type SandboxPointerObservation = {
  phase: "pointerdown" | "pointermove" | "pointerup" | "pointercancel" | "contextmenu";
  x: number;
  y: number;
  button: number;
  buttons: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  pointerId: number;
  pointerType: string;
};

const POINTER_PHASES = new Set<SandboxPointerObservation["phase"]>(["pointerdown", "pointermove", "pointerup", "pointercancel", "contextmenu"]);

function parsePointerObservation(value: unknown): SandboxPointerObservation | null {
  if (!value || typeof value !== "object") return null;
  const observation = value as Record<string, unknown>;
  if (!POINTER_PHASES.has(observation.phase as SandboxPointerObservation["phase"]) || !Number.isFinite(observation.x) || !Number.isFinite(observation.y) || !Number.isInteger(observation.button) || !Number.isInteger(observation.buttons) || !Number.isInteger(observation.pointerId) || typeof observation.pointerType !== "string") return null;
  if ([observation.altKey, observation.ctrlKey, observation.metaKey, observation.shiftKey].some((item) => typeof item !== "boolean")) return null;
  return observation as SandboxPointerObservation;
}

export function postSandboxPointer(frame: HTMLIFrameElement, token: string, observation: SandboxPointerObservation): void {
  frame.contentWindow?.postMessage({ type: "hiraya:wallpaper-pointer", token, observation }, "*");
}

export function terminateSandboxNavigation(frame: HTMLIFrameElement, token: string, options: SandboxNavigationOptions = {}): () => void {
  let initialDocumentLoaded = false;
  let ready = false;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    frame.removeEventListener("load", onLoad);
    window.removeEventListener("message", onMessage);
  };
  const terminate = () => {
    if (stopped) return;
    stop();
    frame.replaceWith((options.replacement ?? (() => document.createElement("iframe")))());
    options.onNavigation?.();
  };
  const onLoad = () => {
    if (!initialDocumentLoaded) { initialDocumentLoaded = true; return; }
    terminate();
  };
  const onMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== frame.contentWindow || !event.data || typeof event.data !== "object") return;
    const message = event.data as Record<string, unknown>;
    if (message.token !== token) return;
    if (message.type === "hiraya:sandbox-pointer") {
      const observation = parsePointerObservation(message.observation);
      if (observation) options.onPointer?.(observation);
      return;
    }
    if (message.type !== "hiraya:sandbox-navigation") return;
    if (message.phase === "navigation") terminate();
    else if (message.phase === "load" && !ready) { ready = true; options.onReady?.(); }
  };
  frame.addEventListener("load", onLoad);
  window.addEventListener("message", onMessage);
  return stop;
}
