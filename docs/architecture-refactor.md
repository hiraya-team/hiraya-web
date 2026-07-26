# Frontend Architecture Refactor

This file is the durable handoff record for the capability-oriented frontend refactor. Update it before starting a phase, after completing a meaningful subtask, and before every checkpoint commit.

## Status

- Baseline frontend commit: `c802248`
- Current phase: 1 - characterization coverage
- State: ready to start
- Next action: add focused characterization tests for extraction seams not already protected by direct tests
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
- [ ] Phase 1: add characterization coverage for high-risk extraction seams.
- [ ] Phase 2: establish neutral domain models and platform ports.
- [ ] Phase 3: split browser persistence by namespace, blobs, database client, and repositories.
- [ ] Phase 4: split synchronization by mutations, replay, reconciliation, connectivity, and transport.
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

## Decisions And Cleanup

- Targeted cleanup is allowed, but external or persisted behavior changes require an explicit entry here.
- Compatibility barrels may be used while imports migrate, but must be listed under temporary scaffolding and reviewed in phase 10.
- Checkpoint commits are created in the frontend submodule. The server receives one final gitlink commit.

## Temporary Scaffolding

- None yet.

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

Phase 1 should prioritize characterization that enables a concrete extraction rather than attempting to fill every integration-test gap at once. Start with neutral persisted models and app-host storage ports because phase 2 depends on them.
