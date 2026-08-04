export function navigationFallbackDenylist() {
  return [
    /^\/(?:api|assets)(?:[/?]|$)/,
    /^\/(?:login|register|profile|logout|admin|shared|published|r)(?:[/?]|$)/,
  ];
}
