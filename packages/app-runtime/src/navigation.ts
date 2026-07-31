type SandboxNavigationOptions = {
  onNavigation?(): void;
  onReady?(): void;
  replacement?(): Node;
};

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
    if (message.type !== "hiraya:sandbox-navigation" || message.token !== token) return;
    if (message.phase === "navigation") terminate();
    else if (message.phase === "load" && !ready) { ready = true; options.onReady?.(); }
  };
  frame.addEventListener("load", onLoad);
  window.addEventListener("message", onMessage);
  return stop;
}
