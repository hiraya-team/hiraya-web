import { APPS_PROTOCOL_VERSION, parseAppConnect, parseAppReady } from "@hiraya/apps-contracts";
import type { AppPackageInspection } from "@hiraya/apps-contracts";
import { RpcDispatcher } from "./dispatcher";
import { terminateSandboxNavigation } from "./navigation";

export type MaterializedApp = { html: string; navigationToken: string; revoke(): void };
export interface SandboxUiRuntime { readonly abi: 1; readonly script: string; readonly styles: string }

export function injectSandboxUiRuntime(document: Document, uiRuntime: SandboxUiRuntime, csp: string, navigationToken: string): void {
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = csp;
  const foundation = document.createElement("style");
  foundation.dataset.hirayaUiFoundation = "";
  foundation.textContent = uiRuntime.styles;
  const navigationGuard = document.createElement("script");
  navigationGuard.dataset.hirayaNavigationGuard = "";
  navigationGuard.src = dataURL(new TextEncoder().encode(`(()=>{const token=${JSON.stringify(navigationToken)};const notify=phase=>parent.postMessage({type:"hiraya:sandbox-navigation",token,phase},"*");addEventListener("load",()=>notify("load"),{once:true});addEventListener("beforeunload",()=>{stop();notify("navigation")},{capture:true,once:true})})()`), "text/javascript");
  const runtime = document.createElement("script");
  runtime.dataset.hirayaUiRuntime = String(uiRuntime.abi);
  runtime.src = dataURL(new TextEncoder().encode(uiRuntime.script), "text/javascript");
  document.head.prepend(meta, foundation, navigationGuard, runtime);
}

export class ObjectUrlLease {
  readonly #urls: string[] = [];
  #revoked = false;

  constructor(private readonly urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL) {}

  create(blob: Blob): string {
    if (this.#revoked) throw new Error("Object URL lease is closed.");
    const url = this.urls.createObjectURL(blob);
    this.#urls.push(url);
    return url;
  }

  revoke(): void {
    if (this.#revoked) return;
    this.#revoked = true;
    for (const url of this.#urls) this.urls.revokeObjectURL(url);
    this.#urls.length = 0;
  }
}

// Apps have an opaque origin. Direct fetch sinks are blocked; navigation is also denied in
// browsers that implement navigate-to and monitored by the host as a fallback.
export const SANDBOX_CSP = "default-src 'none'; script-src data: 'unsafe-inline'; style-src data: 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'";
export const TRUSTED_MARKDOWN_CSP = SANDBOX_CSP.replace("img-src data: blob:", "img-src data: blob: https: http:").replace("navigate-to 'none'", "navigate-to https: http: mailto:");
export const SANDBOX_FLAGS = "allow-scripts allow-downloads allow-forms";
export const TRUSTED_MARKDOWN_FLAGS = `${SANDBOX_FLAGS} allow-popups allow-popups-to-escape-sandbox`;
const MAX_MATERIALIZED_ASSET_CHARACTERS = 64 * 1024 * 1024;

export function createPackageAssetResolver(files: ReadonlyMap<string, Uint8Array>, entrypoint: string) {
  const assetURLs = new Map<string, string>();
  const resolving = new Set<string>();
  let materializedCharacters = 0;
  const resolve = (path: string): string | undefined => {
    const existing = assetURLs.get(path);
    if (existing) return existing;
    const bytes = files.get(path);
    if (!bytes || path === entrypoint) return undefined;
    if (resolving.has(path)) throw new TypeError(`Package asset dependency cycle is not supported: ${path}.`);
    resolving.add(path);
    let body = bytes;
    if (/\.(?:m?js|css)$/i.test(path)) {
      let text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const pattern = /(?:\b(?:import|export)\s+(?:[^"'();]*?\sfrom\s*)?|\bimport\s*\(\s*|@import\s+(?:url\(\s*)?|url\(\s*)(["']?)([^"')\s;]+)\1/g;
      text = text.replace(pattern, (match, _quote: string, reference: string) => {
        const target = resolvePackagePath(reference, path);
        const replacement = target ? resolve(target) : undefined;
        return replacement ? match.replace(reference, replacement) : match;
      });
      body = new TextEncoder().encode(text);
    }
    resolving.delete(path);
    const url = dataURL(body, mimeType(path));
    materializedCharacters += url.length;
    if (materializedCharacters > MAX_MATERIALIZED_ASSET_CHARACTERS) throw new TypeError("Package assets are too large to materialize safely.");
    assetURLs.set(path, url);
    return url;
  };
  return resolve;
}

export function materializeAppPackage(pkg: AppPackageInspection, uiRuntime: SandboxUiRuntime, urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL, csp = SANDBOX_CSP): MaterializedApp {
  if (uiRuntime.abi !== 1 || pkg.manifest.uiRuntime !== uiRuntime.abi) throw new TypeError("App UI runtime ABI is unsupported.");
  const lease = new ObjectUrlLease(urls);
  const resolve = createPackageAssetResolver(pkg.files, pkg.manifest.entrypoint);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(pkg.files.get(pkg.manifest.entrypoint)!);
  const document = new DOMParser().parseFromString(source, "text/html");
  document.querySelectorAll("base").forEach((element) => element.remove());
  document.querySelectorAll("meta[http-equiv]").forEach((element) => {
    if (element.getAttribute("http-equiv")?.trim().toLowerCase() === "refresh") element.remove();
  });
  document.querySelectorAll("iframe, frame, object, embed").forEach((element) => element.remove());
  document.querySelectorAll("form").forEach((element) => element.removeAttribute("action"));
  document.querySelectorAll("[formaction]").forEach((element) => element.removeAttribute("formaction"));
  document.querySelectorAll("a, area").forEach((element) => {
    const href = element.getAttribute("href");
    if (href && !href.startsWith("#")) element.removeAttribute("href");
    element.removeAttribute("target");
  });
  for (const element of document.querySelectorAll<HTMLElement>("[src], [href], [poster], [srcset], [imagesrcset], [ping]")) {
    for (const attribute of ["src", "href", "poster", "srcset", "imagesrcset", "ping"]) {
      const reference = element.getAttribute(attribute);
      if (!reference || reference.startsWith("#") || reference.startsWith("data:")) continue;
      const path = resolvePackagePath(reference, pkg.manifest.entrypoint);
      const replacement = path ? resolve(path) : undefined;
      if (replacement) element.setAttribute(attribute, replacement);
      else element.removeAttribute(attribute);
    }
  }
  for (const element of document.querySelectorAll<HTMLElement>("script:not([src]), style")) {
    const path = pkg.manifest.entrypoint;
    element.textContent = (element.textContent ?? "").replace(/(?:\b(?:import|export)\s+(?:[^"'();]*?\sfrom\s*)?|\bimport\s*\(\s*|url\(\s*)(["']?)([^"')\s]+)\1/g, (match, _quote: string, reference: string) => {
      const target = resolvePackagePath(reference, path);
      const replacement = target ? resolve(target) : undefined;
      return replacement ? match.replace(reference, replacement) : match;
    });
  }
  for (const element of document.querySelectorAll<HTMLElement>("[style]")) {
    const style = element.getAttribute("style") ?? "";
    element.setAttribute("style", style.replace(/url\(\s*(["']?)([^"')\s]+)\1/g, (match, _quote: string, reference: string) => {
      const target = resolvePackagePath(reference, pkg.manifest.entrypoint);
      const replacement = target ? resolve(target) : undefined;
      return replacement ? match.replace(reference, replacement) : match;
    }));
  }
  const navigationToken = crypto.randomUUID().replaceAll("-", "");
  injectSandboxUiRuntime(document, uiRuntime, csp, navigationToken);
  const html = `<!doctype html>\n${document.documentElement.outerHTML}`;
  let revoked = false;
  return { html, navigationToken, revoke: () => { if (revoked) return; revoked = true; lease.revoke(); } };
}

export function isAppPackageName(name: string): boolean {
  return name.toLowerCase().endsWith(".hiraya.app");
}

export type SandboxFrameState = "boot" | "connected" | "ready" | "disposed";

export interface SandboxFrameOptions {
  onNavigation?(): void;
  onStateChange?(state: SandboxFrameState): void;
  bootTimeoutMs?: number;
  timers?: { set(callback: () => void, timeoutMs: number): number; clear(timer: number): void };
}

export function initializeSandboxFrame(frame: HTMLIFrameElement, appId: string, dispatcher: RpcDispatcher, navigationToken: string, options: SandboxFrameOptions = {}): () => void {
  let state: SandboxFrameState = "boot";
  let channel: MessageChannel | null = null;
  let timer = 0;
  const timeoutMs = options.bootTimeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("App boot timeout must be positive.");
  const timers = options.timers ?? {
    set: (callback: () => void, timeoutMs: number) => setTimeout(callback, timeoutMs) as unknown as number,
    clear: (timer: number) => clearTimeout(timer),
  };
  const transition = (next: SandboxFrameState) => { state = next; options.onStateChange?.(next); };
  const stopNavigation = terminateSandboxNavigation(frame, navigationToken, {
    onNavigation: () => {
      if (state === "disposed") return;
      dispose();
      options.onNavigation?.();
    },
  });
  const onConnect = (event: MessageEvent<unknown>) => {
    if (state !== "boot" || channel || event.source !== frame.contentWindow || !frame.contentWindow) return;
    let connect;
    try {
      connect = parseAppConnect(event.data);
      if (connect.appId !== appId) throw new TypeError("App handshake does not match the launched package.");
    } catch {
      return;
    }
    transition("connected");
    channel = new MessageChannel();
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const onReady = (event: MessageEvent<unknown>) => {
      try {
        const ready = parseAppReady(event.data);
        if (ready.appId !== appId || ready.nonce !== nonce) throw new TypeError("App handshake does not match the launched package.");
        timers.clear(timer);
        channel?.port1.removeEventListener("message", onReady);
        dispatcher.attach(channel!.port1);
        transition("ready");
      } catch { dispose(); }
    };
    channel.port1.addEventListener("message", onReady);
    channel.port1.start();
    frame.contentWindow.postMessage({ protocolVersion: APPS_PROTOCOL_VERSION, type: "hiraya:init", appId, nonce }, "*", [channel.port2]);
  };
  const dispose = (closeDispatcher = true) => {
    if (state === "disposed") return;
    timers.clear(timer);
    window.removeEventListener("message", onConnect);
    stopNavigation();
    channel?.port1.close();
    channel?.port2.close();
    if (closeDispatcher) dispatcher.dispose();
    else dispatcher.detach();
    transition("disposed");
  };
  options.onStateChange?.(state);
  timer = timers.set(dispose, timeoutMs);
  window.addEventListener("message", onConnect);
  return () => dispose(false);
}

function resolvePackagePath(reference: string, from: string): string | null {
  try {
    const url = new URL(reference, `https://package.invalid/${from}`);
    if (url.origin !== "https://package.invalid") return null;
    return decodeURIComponent(url.pathname.slice(1));
  } catch { return null; }
}

function mimeType(path: string): string {
  if (/\.m?js$/i.test(path)) return "text/javascript";
  if (/\.css$/i.test(path)) return "text/css";
  if (/\.svg$/i.test(path)) return "image/svg+xml";
  if (/\.json$/i.test(path)) return "application/json";
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.gif$/i.test(path)) return "image/gif";
  if (/\.woff2?$/i.test(path)) return path.toLowerCase().endsWith(".woff2") ? "font/woff2" : "font/woff";
  return "application/octet-stream";
}

function dataURL(bytes: Uint8Array, type: string): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${type};base64,${btoa(binary)}`;
}
