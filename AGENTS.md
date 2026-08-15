# Hiraya Web Agent Guide

## Current Milestone

This repository is a self-contained SolidJS v2 shell proving the new offline foundation. It intentionally contains no React, application platform, editor, viewer, aggregate desktop state, old synchronization protocol, migration reader, or app-kit dependency.

Use Bun for package and script operations:

```sh
bun install --frozen-lockfile
bun test
bun run lint
bun run build
bun run test:e2e
```

## Architecture

- `src/bootstrap.ts` checks required browser capabilities, mounts the shell, and coordinates explicit service-worker activation.
- `src/shell/` owns only the Phase 0 status surface and its native-backed control.
- `src/sw.ts` is the handwritten worker. `/api/**`, server routes, and cross-origin requests are network-only; only hashed built assets use cache-first.
- `src/sw-policy.ts` is the pure request policy shared by worker tests.
- `build/service-worker.ts` injects the exact initial closure after Vite builds.
- `build/bundle-budget.ts` enforces the complete usable shell below 100 KiB gzip.

Do not add a router, global state library, repository layer, event bus, command registry, icon package, CSS-in-JS, PWA framework, app runtime, or compatibility path. Create filesystem and synchronization modules only when their phase begins.

The future storage identity is `hiraya-web2-v1-<account-hash>`. Phase 0 must not open IndexedDB, inspect old databases, or create speculative stores.

## UI

Before changing UI, invoke the `impeccable` skill. Preserve the dusk-green shell, amber accent, restrained desktop chrome, visible focus, 44-pixel targets, reduced motion, forced colors, and narrow-screen behavior. Do not import runtime fonts.

## Verification

Always run the five commands above. Browser acceptance must verify explicit unsupported-storage messaging, keyboard focus, accessibility, narrow and 200% zoom layouts, manifest integrity, offline reload, immutable asset caching, and API cache exclusion.
