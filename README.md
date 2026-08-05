# Hiraya

Hiraya is an installable desktop built with React, TypeScript, Vite, OPFS, and SQLite. It runs browser-local or synchronizes a catalog of named desktops with a same-origin Hiraya server.

The user-oriented [Hiraya User Guide](docs/USER_GUIDE.md) is checked in and bundled into the app for offline Help. It includes a changelog and covers the product model, hierarchy import, desktops and areas, sharing, offline storage, installation, apps, export, backup and recovery, and troubleshooting.

## Development

```sh
bun install
bun run dev
```

The synchronized build uses root-relative `/api` routes and Vite proxies them to `http://127.0.0.1:8080`. Run without a server with:

```sh
HIRAYA_FRONTEND_ONLY=true bun run dev
```

## Checks

```sh
bun test
bun run lint
bun run build
```

## Server Contract

The frontend accepts only remote schema version 2. In synchronized mode it first fetches `GET /api/auth/session`, which returns a stable opaque `storageId`, `user` display metadata, `apiProtocol: "entry-transactions-v1"`, and the required `capabilities.blobTransfer: "direct-b2-v1"` and `capabilities.entryTransactions: "prepare-commit-cancel-v1"`. A 401 redirects to the server-owned `/login` page with a root-relative return path. Authenticated requests send `X-Hiraya-Protocol: entry-transactions-v1`; EventSource uses `/api/events?protocol=entry-transactions-v1`. `GET /api/desktops` returns owned and shared desktops with roles and explicit capabilities, while `GET /api/desktops/{desktopId}?projection=web` preserves the logical layout, editor settings, appearance, and visible-entry projection. Anonymous read-only publications use `/published/{desktopAlias}` or `/published/{desktopAlias}/{itemAlias}` and the matching `/api/public/desktops/...` routes without entering authenticated storage. Events use the `catalog` SSE event; authenticated `/api/sync/health` polling remains a fallback, while `/api/health` remains the public build-health route.

A fresh synchronized browser discovers the server-created first empty desktop through the catalog and projects that desktop into its local cache. If the first catalog request is unavailable, it atomically creates a usable offline desktop and an unbound `create-desktop` record; the first successful catalog fetch binds and replays that record. The active desktop ID is tab-local `sessionStorage` state.

## Runtime Apps And Offline Storage

The build includes six trusted system app fallbacks under `system-apps/`. A synchronized deployment can publish a strict schema-1 `hiraya.apps.json` and immutable `.hiraya.app` releases through its administrator App Store desktop. Runtime catalog releases replace the fallbacks after size, SHA-256, manifest, and runtime compatibility checks. Trusted system releases update automatically and are retained in OPFS for offline launch; ordinary App Store releases retain explicit per-browser approval. User-selected file associations and app-local data are browser/account-local rather than desktop-synchronized.

The browser hashes the session `storageId` into a safe account namespace before loading the desktop or starting workers. The OPFS directory tree, SQLite pool and database, file and pending directories, content markers, workers, locks, preferences, and active desktop session key are all scoped by that namespace. OPFS schema version 5 migrates older versions in place, persists desktop roles so cached shared desktops remain read-only after an offline restart, stores source-aware app installs and normalized file associations, and preserves app storage across bundled app updates. Frontend-only mode makes no auth request and preserves its existing unscoped local storage contract. Logout preserves every account namespace. Synchronized builds remove the old unscoped server-cache layout once rather than migrating it.

Offline mutations update desktop rows and append a strict persisted schema version 1 outbox record atomically. These logical records remain stable across the wire-schema cut. Every record has a `desktopId`; `catalogId` is nullable only before the first successful desktop-list fetch. Replay translates logical operations to generic `entry.create`, `entry.patch`, `entry.content.write`, `entry.trash`, `entry.restore`, `entry.purge`, or `entry.transfer` operations without rewriting operation IDs, staged blobs, causal keys, or conflict records. Shared writes require an online connection. File bytes are staged before metadata is exposed; downloaded bytes are accepted only for the matching catalog, desktop, entry revision, and size. The browser cache and outbox are not a backup.

User mutations return after that durable local commit; server replay, upload, reconciliation, and retry are never part of the interaction's critical path. See [Background Synchronization Decision](docs/background-synchronization.md) for the canonical interaction contract, failure semantics, and exceptions.

Replay posts generic operations to `/api/desktops/{anchorDesktopId}/entries/transactions` with the durable outbox identity. Transactions that need bytes return upload targets; the client PUTs staged content directly, commits through the transaction endpoint, and best-effort cancels an uncommitted preparation after failure. Layout, editor settings, theme selection, theme definitions, and theme packages use their protected system-entry identities while preserving the logical web projection. `GET /api/desktops/{desktopId}/entries/{entryId}/content?revision=...` returns either verified bytes or a short-lived direct-access descriptor; media previews add `purpose=preview`. Public content uses the equivalent publication-scoped route. Presigned targets and object-store credentials are never persisted.

## Routes And Areas

The canonical pathname is `/desktops/{desktopId}/areas/{column}/{row}` with optional explorer, file, properties, or settings suffixes. Routing uses the browser History API; hashes are not routes. The transient `?open=` file-path query is replaced with the corresponding canonical file pathname after resolution. The static host must serve `index.html` for direct requests to desktop paths; GitHub Pages does not provide the required fallback. Root coordinates form one continuous canvas; visible areas are derived segments and are not persisted.

## Portable Data

Seeded packages, clipboard archives, window sessions, and browser history use strict schema version 1 envelopes. Entries require `createdAt`. Earlier versions and aliases are intentionally rejected.

Set `HIRAYA_SEEDED_DIR` to a package directory containing `manifest.json` and referenced content:

```sh
HIRAYA_SEEDED_DIR=examples/seeded bun run build
```

Seeded content is used only for a fresh frontend-only origin. Synchronized installs converge from the server catalog.

Calculator, ZIP Browser, Pixel Editor, Project Studio, Hiraya POS, and Todo are released from `hiraya-team/hiraya-apps` and installed through the runtime App Store catalog. To publish an app without rebuilding Hiraya, initialize a CLI synchronization root for the designated App Store desktop, then run:

```sh
bun run apps:release -- --server https://hiraya.example --store-root /path/to/app-store --kind store --slug calculator calculator.hiraya.app
```

The release command checks the target runtime contract, uploads the immutable package first, then activates it by updating `hiraya.apps.json`. Use `--kind system` for trusted system releases.
