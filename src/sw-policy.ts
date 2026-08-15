export type RequestPolicy = "network-only" | "cache-first" | "navigation";

const SERVER_ROUTES = /^\/(?:login|register|profile|logout|admin|auth|shared|published|r|system-apps)(?:\/|$)/;

export function requestPolicy(url: string, mode: RequestMode, origin: string, basePath = "/"): RequestPolicy {
  const target = new URL(url);
  if (target.origin !== origin || target.pathname === "/api" || target.pathname.startsWith("/api/")) return "network-only";
  if (target.pathname.startsWith(`${basePath}assets/`)) return "cache-first";
  if (mode !== "navigate" || !target.pathname.startsWith(basePath)) return "network-only";
  const relativePath = `/${target.pathname.slice(basePath.length)}`.replace(/\/{2,}/g, "/");
  return SERVER_ROUTES.test(relativePath) ? "network-only" : "navigation";
}
