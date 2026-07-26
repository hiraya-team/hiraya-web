# Frontend Architecture Refactor

This file is the durable handoff record for the capability-oriented frontend refactor. Update it before starting a phase, after completing a meaningful subtask, and before every checkpoint commit.

## Status

- Baseline frontend commit: `c802248`
- Current phase: complete
- State: verified
- Next action: update and commit the server gitlink
- Server gitlink: ready to update to the final verified frontend commit
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
- [x] Phase 5: reduce `App.tsx` to authenticated desktop composition.
- [x] Phase 6: isolate app installation, launch, sandbox, host service, and teardown lifecycles.
- [x] Phase 7: unify reusable interaction mechanics while retaining feature-owned behavior.
- [x] Phase 8: modularize the design system and CSS without redesigning the desktop.
- [x] Phase 9: recompose the public desktop from read-only capabilities.
- [x] Phase 10: remove migration scaffolding and enforce all dependency boundaries.
- [x] Final: run frontend, server, browser, synchronized-session, and Docker verification.

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

### Phase 5 Checkpoint: Window State

- Moved running window React state, synchronous refs, focused-window ownership, and z-index allocation into `src/features/windows/controller.ts`.
- Kept route synchronization, area-aware focus, pointer geometry, file loading, and app lifecycle notifications in the composition root.
- Added stable controller callbacks and explicit effect dependencies; lint passes without hook warnings.
- Fixed sandbox ownership discovered during browser verification: frame effect cleanup now detaches its RPC channel without permanently closing the externally owned dispatcher and host lifecycle.
- Added a dispatcher detach/reattach regression test.
- Browser smoke: system text editor opened, minimized, restored, and closed successfully with no new console messages; desktop and 390px viewport transitions remained operational.
- `bun test`: passed, 400 tests across 76 files
- `bun run lint`: passed
- `bun run build`: passed, including storage worker, system app, and example app bundles

### Phase 5 Checkpoint: Selection State

- Moved selected IDs, synchronous selection refs, selection surfaces, anchors, range/toggle rules, mobile multi-select, and reconciliation pruning into `src/features/selection/controller.ts`.
- Kept entry-domain actions and shell-specific context menus in the composition root.
- Added direct tests for single, toggle, preserved, and bidirectional range selection.
- `bun test`: passed, 402 tests across 77 files
- `bun run lint`: passed
- `bun run build`: passed, including storage worker, system app, and example app bundles

### Phase 5 Checkpoint: Window Layer

- Moved window-track geometry, segment projection and visibility, mobile bounds, frame chrome, and window controls into `src/features/windows/WindowLayer.tsx`.
- Kept explorer, properties, settings, and sandbox content wiring in the authenticated desktop composition root through an explicit render callback.
- Updated source-level mobile-window regression checks to follow the extracted ownership boundary.
- Browser smoke: a system text editor opened, minimized, restored, maximized, rendered at a 390px viewport, and closed successfully with no new console errors.
- `bun test`: passed, 402 tests across 77 files
- `bun run lint`: passed
- `bun run build`: passed, including storage worker, system app, and example app bundles

### Phase 5 Checkpoint: Area Switcher Layer

- Moved the authenticated minimap grid, open-window strip, focused-window controls, accessibility state, and responsive area-switcher markup into `src/features/areas/AreaSwitcher.tsx`.
- Kept drag/swipe ownership, focus restoration, route commits, and direct shell transform coordination in the composition root.
- Updated source-level area-switcher regression checks to follow the extracted feature boundary.
- Browser smoke: expanded the switcher, selected an adjacent empty area, resized to 390px, and retained the current-area controls with no new console errors.
- `bun test`: passed, 402 tests across 77 files
- `bun run lint`: passed
- `bun run build`: passed, including storage worker, system app, and example app bundles

### Phase 6 Checkpoint: App Platform Ownership

- Added `src/features/app-management/controller.ts` to own app lifecycle, theme, capability, persistent storage, dialog, and notification services.
- Moved durable installed-app, bundled-app, association, and quarantine loading and mutations behind the app-management controller.
- Bundled app archives remain identity-verified before their durable records are refreshed.
- Browser smoke: Settings reported all five bundled apps and launched the system text editor with no new console errors.
- `bun test`: passed, 402 tests across 77 files
- `bun run lint`: passed
- `bun run build`: passed, including storage worker, system app, and example app bundles

### Phase 6 Checkpoint: Sandbox Launch Transaction

- Added `src/features/app-management/launch.ts` as the verified package-to-running-instance transaction.
- Package identity and digest validation, stable system-target identity, capability grants, host/file services, runtime RPC, command contributions, and partial-failure cleanup now complete before a sandbox window is published.
- The composition root retains route history and running-window publication only after the transaction returns a complete app instance.
- Browser smoke: launched and closed the bundled text editor from Settings with no new console errors.
- `bun test`: passed, 402 tests across 77 files
- `bun run lint`: passed
- `bun run build`: passed, including storage worker, system app, and example app bundles

### Phase 7

- Audited authenticated desktop icons, folder explorer rows, and public desktop icons against the shared touch policy.
- Retained distinct movement thresholds, long-press behavior, and drag/drop ownership where each surface has different semantics.
- Added `resolveTouchRelease` as the shared touch-release state transition, including synthetic double-click suppression and next-tap ownership.
- Updated all three icon surfaces to use the same release arbitration and added direct transition coverage.
- `bun test`: passed, 403 tests across 77 files
- `bun run lint`: passed
- `bun run build`: passed, including storage worker, system app, and example app bundles

### Phase 8

- Added `src/styles/index.css` as the explicit ordered stylesheet entrypoint.
- Moved document defaults, fallback design tokens, reset rules, inherited controls, and global focus treatment into `src/styles/foundation.css`.
- Kept the existing desktop and feature cascade in one ordered file because its late ownership overrides are behaviorally coupled; arbitrary file slicing would change source order without improving ownership.
- Added tests locking foundation-before-feature order and preventing document reset rules from drifting back into feature CSS.
- Browser smoke: desktop and 390px shell/window rendering remained intact with no new console errors.
- `bun test`: passed, 405 tests across 78 files
- `bun run lint`: passed
- `bun run build`: passed, including storage worker, system app, and example app bundles

### Phase 9

- Added `src/features/public-desktop/controller.ts` as the read-only authority for public catalog fetch, revision-qualified file reads, downloads, large-file authentication gates, and wallpaper object URLs.
- Kept selection, folder navigation, responsive window bounds, and rendering in `PublicDesktop` as composition concerns.
- Added direct local-link resolution coverage, including traversal and external-scheme rejection.
- Extended the public desktop import boundary to the new controller.
- Browser smoke: invalid public routes rendered the desktop/mobile unavailable state without authenticated modules or new console errors.
- `bun test`: passed, 406 tests across 78 files
- `bun run lint`: passed
- `bun run build`: passed, including storage worker, system app, and example app bundles

### Phase 10

- Removed desktop-state, theme, preference, save-option, conflict, storage-namespace, and staging compatibility exports from `lib/opfs.ts`, `lib/desktop-state.ts`, and `lib/themes.ts`.
- Migrated consumers to direct domain, storage namespace, and blob platform imports.
- Replaced the sync storage adapter-derived `Pick` with an explicit, narrower `SyncStorage` contract.
- Added dependency rules for storage, shared components, and features, plus source-level migration boundary tests.
- Documented worker entrypoint placement as an intentional build and persisted-parser boundary; no temporary scaffolding remains.
- `bun test`: passed, 408 tests across 79 files
- `bun run lint`: passed
- `bun run build`: passed, including storage worker, system app, and example app bundles

### Final Verification

- Frontend commit under test: `c4dc4e6` (the following ledger-only commit does not change runtime artifacts).
- `bun test`: passed, 408 tests across 79 files.
- `bun run lint`: passed.
- `bun run build`: passed, including storage worker, system app, and example app bundles.
- `go test ./...`: passed.
- `go vet ./...`: passed.
- Built `hiraya-server:architecture-refactor` from the server workspace and pinned frontend; `/`, SPA fallback, `/api/health`, authenticated session bootstrap, static immutable cache headers, and schema version 1 responses were verified.
- Local blob mode: two independent authenticated HTTP sessions observed one catalog authority; multipart metadata and bytes were created in one session and read byte-for-byte in the other.
- Direct S3-compatible mode: an isolated TLS MinIO deployment verified presigned browser upload, commit, revision-qualified download, and server restart persistence without a local content fallback.
- Browser verification: a 1920x1080 session created and edited `direct-persistence.txt`; an isolated 390x844 session observed the synchronized metadata and content.
- Offline replay: the mobile session edited the file while network access was disabled, retained protected pending content, reconnected, replayed the mutation, and read `Architecture refactor offline replay verified.` at content revision 4 after server restart.
- SSE propagation: an authenticated stream observed the catalog revision before and after a mutation; health polling and reconciliation remained active as the fallback path.
- Exact-image browser console and page-error checks remained empty during the final desktop and mobile smoke checks.

## Decisions And Cleanup

- Targeted cleanup is allowed, but external or persisted behavior changes require an explicit entry here.
- Compatibility barrels may be used while imports migrate, but must be listed under temporary scaffolding and reviewed in phase 10.
- Checkpoint commits are created in the frontend submodule. The server receives one final gitlink commit.

## Temporary Scaffolding

- None.

Worker entrypoints and protocol/schema leaves remain under `src/lib/` by design: they are build entrypoints and persisted-format parsers, while `src/platform/storage/database-client.ts` owns their browser lifecycle. Moving those files would change worker URLs and migration-relative imports without changing dependency ownership.

## Known Risks

- `src/App.tsx` remains the largest composition root and coordinates cross-feature desktop, route, preference, and synchronization behavior.
- `SyncEngine` still coordinates mutation ordering, replay, and reconciliation even though transport, connectivity, and storage dependencies now use explicit boundaries.
- `src/lib/opfs.ts` retains local mutation orchestration because content-before-metadata and atomic outbox publication span storage capabilities.
- `src/styles.css` relies on source order across more than 6,000 lines.
- Public and authenticated feature policies can still drift around the shared touch-release primitive.
- Several accessibility regressions are protected by source or CSS assertions rather than rendered interaction tests.

## Resume Procedure

1. Run `git status --short`, `git diff`, and `git log --oneline -10` in the frontend.
2. Read this file from `Status` through the current phase notes.
3. Preserve unrelated worktree changes.
4. Continue the exact `Next action`, or update it before taking a different approach.
5. Do not mark a phase complete until its acceptance checks pass.
6. Commit only the files belonging to the completed checkpoint.

## Current Phase Notes

All phases and final acceptance checks are complete. No temporary migration scaffolding remains; the next repository action is the final frontend documentation checkpoint followed by the server gitlink commit.
