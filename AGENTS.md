# Hiraya Frontend Agent Guide

## Project Overview

This repository is the public Hiraya frontend. It is a React, TypeScript, and Vite progressive web app that can run browser-local or synchronize with the private Hiraya server through same-origin `/api` routes. The server repository pins this repository as its `frontend` submodule.

Use Bun for package and script operations:

```sh
bun install
bun test
bun run lint
bun run build
bun run dev
```

## Architecture

- `src/App.tsx`: authenticated desktop composition root for cross-feature routing, preferences, synchronization, and shell orchestration.
- `src/PublicDesktop.tsx`: public desktop composition root; read-only remote authority belongs in `src/features/public-desktop/`.
- `src/domain/`: browser-independent desktop, file, preference, and theme contracts.
- `src/features/`: feature-owned controllers and render layers for windows, areas, selection, app management, and public desktop behavior.
- `src/lib/sync.ts`: synchronization engine coordinating mutation ordering, durable replay, and reconciliation.
- `src/platform/sync/`: synchronization storage port, authenticated HTTP policy, connectivity, and outbox transport adapters.
- `src/lib/opfs.ts`: serialized local desktop mutation facade preserving content-before-metadata and atomic outbox publication.
- `src/platform/storage/`: storage namespace, OPFS blobs, SQLite worker client, and device/app repositories. Keep browser storage implementations inside this platform boundary.
- `src/lib/contracts.ts`: runtime validation for strict catalog/desktop schema version 1.
- `src/lib/api-routes.ts`: same-origin API route construction.
- `src/lib/seeded-manifest.ts`: seeded manifest validation shared by the build loader and exporter.
- `src/lib/seeded.ts`: seeded ZIP export.
- `build/seeded.ts`: Vite plugin that validates and bundles optional seeded content.
- `vite.config.ts`: seeded content, PWA generation, and the development `/api` proxy.
- `src/components/`: shared desktop windows, icons, dialogs, menus, and previews; shared components must not import product features or platform adapters.
- `src/ui/`: desktop geometry, window management, and UI-domain helpers.
- `src/styles/index.css`: ordered stylesheet entrypoint; it loads global foundations before the legacy feature cascade.
- `src/styles/foundation.css`: document defaults, design tokens, reset rules, inherited controls, and global focus treatment.
- `src/styles.css`: intentionally ordered visual system, wallpaper, responsive behavior, and motion fallbacks. Preserve source order unless a change proves equivalent cascade behavior.

Prefer small changes in existing modules. Do not introduce global state or a component framework without a concrete need.

Preserve the enforced dependency direction: domain code is browser- and React-independent; storage does not import UI, features, synchronization, or app-host implementations; synchronization depends on `SyncStorage`; shared components do not import features or platform adapters; composition roots wire unrelated capabilities together.

## UI Skill Requirement

- Before analyzing, designing, or implementing any UI-related change, invoke the `design-taste-frontend` skill and follow its complete workflow, including its audit and pre-flight requirements. This is mandatory for every UI change, however small.
- Do not begin UI edits until the skill has been invoked. If the skill is unavailable, stop and ask the user how to proceed rather than bypassing it.

## Storage And Sync Invariants

- OPFS is authoritative only in frontend-only mode. In synchronized mode it is a cache and projected offline desktop.
- Browser storage implementations belong in `src/platform/storage/`. Local desktop mutations go through `src/lib/opfs.ts`; namespace, repository, and blob consumers may use the narrower platform modules directly when their capability boundary requires it.
- Physical browser files use stable UUIDs; user-facing names and folders are metadata.
- The OPFS SQLite schema is version 8, normalized by desktop, and migrates older versions in place. It stores namespaced device preferences, including the folder explorer view and browser pinch-zoom choice, and reserves normalized offline pins without changing their runtime behavior.
- Offline mutations update the projected SQLite desktop and append an outbox operation atomically.
- Replay uses stable idempotency headers and preserves blocked operations for user resolution.
- During reconciliation, publish validated metadata without requiring file bytes. Fetch virtual file content on demand, validate its revision and size, and cache it before use.
- Write file contents before adding metadata that references them.
- Renaming and reparenting update metadata only.
- Validate complete multi-file operations before writing any file.
- Preserve unsaved editor text when remote content changes.
- Keep API responses and SSE outside service-worker precaching.
- OPFS is origin-scoped and is removed when browser site data is cleared.
- Select the session `storageId` namespace before importing desktop code or starting storage workers. Scope OPFS directories, SQLite, workers, locks, cache markers, and active desktop session state; logout must not delete account storage.

## API Compatibility

- The current HTTP catalog and desktop schema is version 1 and is validated by `src/lib/contracts.ts`.
- Keep TypeScript IDs, names, hierarchy, MIME, coordinates, themes, layout, and settings validation equivalent to the server contract.
- API paths, multipart field names, content types, and `X-Hiraya-Client-ID` / `X-Hiraya-Operation-ID` headers are durable replay contracts.
- SSE carries `catalog` revision notifications; health polling remains a fallback for dead streams.
- Synchronized startup requires `/api/auth/session` with `capabilities.blobTransfer: "direct-b2-v1"`; all authenticated 401 responses pause replay and redirect to server-owned login without blocking outbox records. Sync polling uses `/api/sync/health`, not public `/api/health`.
- Root-relative `/api` routes preserve same-origin deployment. The explicit cross-origin exception is presigned direct blob transfer: targets must use safe HTTPS URLs, allow the required checksum headers through CORS, and remain revision-qualified. Do not add any other cross-origin behavior implicitly.
- Outbox operations require schema version 1 and `desktopId`. `catalogId` may be null only until first contact; replay only records belonging to the active authority catalog.

## Seeded Desktops

- `HIRAYA_SEEDED_DIR` must point inside this repository and is never exposed to browser code.
- Seeded packages accept only schema version 1 and require `createdAt` on every entry.
- Fetch and validate every seeded asset before publishing complete metadata.
- Never seed, merge into, or replace an existing desktop, including an intentionally empty one.
- Export preserves stable IDs, signed finite coordinates, empty folders, layout, appearance, and editor settings.
- `examples/seeded` is the canonical package example.

## Interaction And UI

- Treat Hiraya as a desktop environment, not a marketing page. Its core interaction model and visual language must remain familiar, coherent, and predictable.
- Use `DESIGN_VARIANCE: 3`, `MOTION_INTENSITY: 3`, and `VISUAL_DENSITY: 5` as the default design dials for desktop UI work.
- Favor conventional window geometry, menus, controls, alignment, selection states, and keyboard behavior over novel interaction patterns. Express personality through the established wallpaper, palette, typography, and subtle material treatment instead.
- Use motion only when it clarifies opening, closing, focusing, movement, feedback, or another state transition.
- Dragging applies direct transforms during pointer movement and commits state only on release.
- Use Pointer Events and keep icons reachable on desktop and mobile.
- Root coordinates occupy one continuous logical surface; surface segments are derived and never persisted.
- External file input and drag-and-drop must use the same import path.
- Revoke every object URL created for media or document previews.
- Preserve keyboard access, `Escape` dismissal, and `Ctrl+S` / `Cmd+S` saving.
- Preserve the dusk-green wallpaper, amber accent, translucent menu bar, restrained chrome, and Phosphor icon family.
- Honor WCAG AA contrast and `prefers-reduced-motion`.
- Do not add runtime font imports.

## Verification

Always run:

```sh
bun test
bun run lint
bun run build
```

For storage or interaction changes, also create, edit, save, rename, upload, drag, reload, and verify persistence. Check the console and test desktop plus an approximately 390px-wide viewport.

For server integration changes, test against the server repository's pinned submodule workflow in two isolated browser sessions. Verify direct HTTPS blob upload/download with production-equivalent CORS, offline mutation, reconnection, SSE propagation, restart persistence, and schema compatibility.

For seeded changes, build with `HIRAYA_SEEDED_DIR` unset and with `examples/seeded`, verify fresh versus existing origins, export a ZIP, and build from the extracted package.
