/** Identifies the synchronized server protocol on wire messages and sessions. */
export const WEB2_SYNC_PROTOCOL = "web2-sync-v1" as const;

/** Names the HTTP headers owned by the synchronized server protocol. */
export const WEB2_HEADERS = {
  protocol: "X-Hiraya-Protocol",
  operationId: "X-Hiraya-Operation-ID",
} as const;
