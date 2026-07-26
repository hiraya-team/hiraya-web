# Frontend Architecture Refactor

This file is the durable handoff record for the capability-oriented frontend refactor. Update it before starting a phase, after completing a meaningful subtask, and before every checkpoint commit.

## Status

- Baseline frontend commit: `c802248`
- Current phase: 5 - authenticated desktop composition
- State: in progress
- Next action: extract the running-window state controller from `App.tsx`, preserving direct pointer transforms and route synchronization
- Server gitlink: update only after the complete frontend refactor passes final verification
- Push policy: do not push as part of this refactor

## Scope

The refactor may include targeted cleanup when it materially simplifies a boundary. It must preserve persisted data, HTTP contracts, durable replay identity, storage authority, app package compatibility, sandbox security, and established desktop behavior unless a deliberate change is recorded below with migration and verification details.

The work does not introduce a global state framework by default. Feature-local controllers and explicit service ports are preferred.

## Target Dependency Direction

```text
bootstrap and composition roots
  -> feature UI and controllers
    -> domain models, policies, and use cases
      -> platform ports
        -> browser and server adapters

features -> shared UI and interaction primitives
```

Rules:

- Domain code does not import React, browser storage, transport, or feature UI.
- Storage does not import UI, React components, synchronization, or app-host implementations.
- Synchronization depends on storage ports rather than the concrete OPFS facade.
- App host depends on host-facing file and storage ports rather than OPFS implementation types.
- Shared UI does not import product features.
- Interaction primitives do not encode file, window, explorer, or area policy.
- Public desktop does not import authenticated sync, outbox, OPFS, mutation, or app-host modules.
- Composition roots are the only modules allowed to wire unrelated capabilities together.
- Migrations remain beside the persisted state they evolve.

## Target Capabilities

```text
src/
  app/
    bootstrap/
    authenticated-desktop/
    public-desktop/
    routing/
  domain/
    catalog/
    desktop/
    entries/
    permissions/
    sharing/
    apps/
  features/
    desktop-surface/
    areas/
    windows/
    explorer/
    file-operations/
    search/
    clipboard/
    trash/
    sharing/
    activity/
    settings/
    offline-management/
    app-management/
  platform/
    auth/
    storage/
    sync/
    pwa/
    app-host/
  ui/
    primitives/
    dialogs/
    overlays/
    theme/
    responsive/
    interactions/
```

This is a destination map, not a requirement to create empty directories or one file per concept.

## Phase Checklist

- [x] Phase 0: establish this ledger, correct architecture documentation, and add baseline guardrails.
- [x] Phase 1: add characterization coverage for high-risk extraction seams.
- [x] Phase 2: establish neutral domain models and platform ports.
- [x] Phase 3: split browser persistence by namespace, blobs, database client, and repositories.
- [x] Phase 4: split synchronization by mutations, replay, reconciliation, connectivity, and transport.
- [ ] Phase 5: reduce `App.tsx` to authenticated desktop composition.
- [ ] Phase 6: isolate app installation, launch, sandbox, host service, and teardown lifecycles.
- [ ] Phase 7: unify reusable interaction mechanics while retaining feature-owned behavior.
- [ ] Phase 8: modularize the design system and CSS without redesigning the desktop.
- [ ] Phase 9: recompose the public desktop from read-only capabilities.
- [ ] Phase 10: remove migration scaffolding and enforce all dependency boundaries.
- [ ] Final: run frontend, server, browser, synchronized-session, and Docker verification.

## Phase Acceptance

Every frontend checkpoint requires:

```sh
bun test
bun run lint
bun run build
```

Storage, interaction, and UI phases also require focused browser checks on desktop and an approximately 390px viewport. Synchronization phases require two isolated sessions, offline replay, SSE propagation, restart persistence, and schema compatibility. Final verification additionally requires `go test ./...`, `go vet ./...`, and a Docker build from the pinned frontend commit.

## Verification Log

### Baseline `c802248`

- `bun test`: passed, 393 tests across 75 files
- `bun run lint`: passed
- `bun run build`: passed, including system and example app builds and packages
- Existing build warning: the production build reports chunks larger than 500 kB

### Phase 0

- `bun test`: passed, 393 tests across 75 files
- `bun run lint`: passed with the public desktop boundary rule enabled
- `bun run build`: passed, including system and example app builds and packages

### Phase 1

- Added a populated schema 2 fixture that executes every supported migration through schema 8 and verifies preferences, installed-app storage, offline pins, and foreign keys.
- Locked the observable content-revision conflict name, message, expected revision, and actual revision before moving the error below OPFS.
- `bun test`: passed, 395 tests across 75 files
- `bun run lint`: passed
- `bun run build`: passed, including system and example app builds and packages

### Phase 2

- Added neutral domain contracts for themes, desktop state, file-save conflicts, and device preferences.
- Removed the storage-to-UI dependency for the persisted folder explorer view.
- Removed app-host imports of OPFS implementation types and errors.
- Moved app package inspection into `@hiraya/apps-contracts`; app-runtime no longer depends on app-CLI.
- Added lint rules protecting domain, persistence, app-host, and app-runtime dependency directions.
- `bun test`: passed, 395 tests across 75 files
- `bun run lint`: passed
- `bun run build`: passed, including system and example app builds and packages

### Phase 3

- Extracted account namespace selection, legacy cleanup, active desktop context, cross-tab locking, and serialized storage work into `src/platform/storage/namespace.ts`.
- Extracted OPFS file blobs, revision markers, durable pending content, materialization, and cleanup into `src/platform/storage/blobs.ts`.
- Extracted SharedWorker/fallback worker ownership, request retries, timeouts, and protocol initialization into `src/platform/storage/database-client.ts`.
- Extracted preferences, window sessions, installed apps, associations, and app storage database adapters into `src/platform/storage/repositories.ts`.
- Retained local desktop mutation orchestration in the `opfs.ts` facade to preserve content-before-metadata and atomic outbox ordering.
- Browser smoke: frontend-only startup created `phase3-storage.txt`, reload restored it, and browser errors remained empty.
- `bun test`: passed, 395 tests across 75 files
- `bun run lint`: passed
- `bun run build`: passed, including storage worker, system app, and example app bundles

### Phase 4

- Added a named synchronization storage port and moved the browser OPFS adapter out of `SyncEngine` construction.
- Extracted authenticated JSON request policy and synchronization errors into `src/platform/sync/http-client.ts`.
- Extracted EventSource and health timer ownership into `src/platform/sync/connectivity.ts`; reconciliation decisions remain in the engine.
- Extracted idempotency headers, mutation route selection, direct blob upload, commit retry classification, and abort cleanup into `src/platform/sync/outbox-transport.ts`.
- Kept replay ordering and reconciliation generation checks together in `SyncEngine`, where they coordinate storage publication and lifecycle cancellation.
- `bun test`: passed, 395 tests across 75 files
- `bun run lint`: passed
- `bun run build`: passed, including storage worker, system app, and example app bundles

### Phase 5 Checkpoint: Window Model

- Moved running app/window discriminated unions and pure area projections into `src/features/windows/model.ts`.
- Moved strict browser-history parsing, state construction, and focused-window route projection into `src/features/windows/history.ts`.
- Added direct tests for area projection, top-window selection, persisted targets, instance IDs, and route history.
- `bun test`: passed, 399 tests across 76 files
- `bun run lint`: passed
- `bun run build`: passed, including storage worker, system app, and example app bundles

## Decisions And Cleanup

- Targeted cleanup is allowed, but external or persisted behavior changes require an explicit entry here.
- Compatibility barrels may be used while imports migrate, but must be listed under temporary scaffolding and reviewed in phase 10.
- Checkpoint commits are created in the frontend submodule. The server receives one final gitlink commit.

## Temporary Scaffolding

- `src/lib/opfs.ts` re-exports neutral desktop-state, preference, save-option, and conflict contracts while consumers migrate to direct domain imports.
- `src/lib/desktop-state.ts` and `src/lib/themes.ts` re-export domain types while runtime parser imports migrate.
- Storage worker entrypoints and protocol/schema leaves remain under `src/lib/`; the platform database client owns them but paths are deferred to avoid mixing a large worker-relative-path move into the behavioral extraction.
- `src/platform/sync/storage-port.ts` derives its method signatures from the browser adapter during migration; phase 10 should replace this with implementation-independent port declarations once callers have stabilized.

## Known Risks

- `src/App.tsx` owns desktop, route, selection, window, area, app-host, preference, and sync orchestration.
- `src/lib/sync.ts` combines domain mutation behavior, replay, reconciliation, connectivity, and transport.
- `src/lib/opfs.ts` combines OPFS blobs, SQLite RPC, repositories, app storage, preferences, and offline inventory.
- `src/styles.css` relies on source order across more than 6,000 lines.
- Public and authenticated gesture implementations can drift.
- Several accessibility regressions are protected by source or CSS assertions rather than rendered interaction tests.

## Resume Procedure

1. Run `git status --short`, `git diff`, and `git log --oneline -10` in the frontend.
2. Read this file from `Status` through the current phase notes.
3. Preserve unrelated worktree changes.
4. Continue the exact `Next action`, or update it before taking a different approach.
5. Do not mark a phase complete until its acceptance checks pass.
6. Commit only the files belonging to the completed checkpoint.

## Current Phase Notes

Phase 5 begins with low-risk pure ownership: running-window models, route/history state, and shell render layers. Do not start by moving all React state into one large hook; extract cohesive controllers one at a time and keep `App.tsx` as the composition root throughout.
