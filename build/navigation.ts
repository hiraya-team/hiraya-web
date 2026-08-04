export function navigationFallbackDenylist(base: string) {
  const basePath = base === "/" ? "" : base.replace(/\/$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    /^\/(?:api|assets)(?:[/?]|$)/,
    new RegExp(`^${basePath}/app-store(?:[/?]|$)`),
    /^\/(?:login|register|profile|logout|admin|shared|published|r)(?:[/?]|$)/,
  ];
}
