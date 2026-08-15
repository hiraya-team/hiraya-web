# Hiraya Web

The Phase 0 SolidJS foundation for Hiraya's new local-first browser workspace.

This destructive cutover removes the previous React desktop, application runtime, editors, viewers, Workbox worker, package workspaces, old storage architecture, and compatibility paths. The current shell proves browser capability checks, explicit service-worker activation, offline reload, and a complete sub-100 KiB gzip closure.

## Development

```sh
bun install --frozen-lockfile
bun run dev
```

The development server proxies `/api` to `http://127.0.0.1:8080`.

## Verification

```sh
bun test
bun run lint
bun run build
bun run test:e2e
```

`bun run build` emits the Vite shell, builds the handwritten `sw.js`, and rejects forbidden dependencies or any closure at or above 100 KiB gzip.

## Current Limits

No files, settings, synchronization, account bootstrap, or applications are available in this milestone. Phase 0 checks required APIs but deliberately does not open IndexedDB or inspect previous browser data.
