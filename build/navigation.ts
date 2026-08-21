/** Builds the service-worker navigation fallback denylist. */
export function navigationFallbackDenylist() {
  return [
    /^\/(?:api|assets)(?:[/?]|$)/,
    /^\/(?:login|register|profile|logout|admin|auth|shared|published|r)(?:[/?]|$)/,
  ];
}
