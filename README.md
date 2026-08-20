# Hiraya

Hiraya is an installable desktop built with React, TypeScript, Vite, IndexedDB, and OPFS. It runs browser-local or synchronizes a catalog of named desktops with a same-origin Hiraya server.

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

Frontend-only mode always uses the fresh Web2 filesystem, settings, workspace,
window-session, and app repositories. It does not open legacy IndexedDB or OPFS
namespaces.

## Checks

```sh
bun test
bun run lint
bun run build
```

## Server Contract

The deployed legacy frontend accepts only remote schema version 2. In synchronized mode it first fetches `GET /api/auth/session`, which returns a stable opaque `storageId`, `user` display metadata, `directBlobOrigin`, `apiProtocol: "entry-transactions-v2"`, and the required `capabilities.entryTransactions: "prepare-commit-cancel-v1"`. A 401 redirects to the server-owned `/login` page with a root-relative return path. Authenticated requests send `X-Hiraya-Protocol: entry-transactions-v2`; EventSource uses `/api/events?protocol=entry-transactions-v2`. `GET /api/desktops` returns owned and shared desktops with roles and explicit capabilities, while `GET /api/desktops/{desktopId}?projection=web` preserves the logical layout, editor settings, appearance, and visible-entry projection. Anonymous read-only publications use `/published/{desktopAlias}` or `/published/{desktopAlias}/{itemAlias}` and the matching `/api/public/desktops/...` routes without entering authenticated storage. Events use the `catalog` SSE event; authenticated `/api/sync/health` polling remains a fallback, while `/api/health` remains the public build-health route.

The Web2 synchronization target uses schema 1 and `X-Hiraya-Protocol: web2-sync-v1`.
Its fresh browser namespaces hash the selected account's server-issued
`storageId` as exact UTF-8 bytes to full lowercase SHA-256 hexadecimal; they do
not hash the account ID. Frontend-only mode uses the same normalized storage
model with a fixed local account identity; synchronized production activation
remains separate from that local runtime.

A fresh synchronized browser discovers the server-created first empty desktop through the catalog and projects that desktop into its local cache. If the first catalog request is unavailable, it atomically creates a usable offline desktop and an unbound `create-desktop` record; the first successful catalog fetch binds and replays that record. The active desktop ID is tab-local `sessionStorage` state.

## Runtime Apps And Offline Storage

The build includes six authoritative trusted system apps under `system-apps/` and emits `system-apps/catalog.json` with their exact manifests, sizes, and SHA-256 digests. Trusted system releases update from the deployed image and are retained in OPFS for offline launch. User-selected file associations and app-local data are browser/account-local rather than desktop-synchronized.

The browser hashes the session `storageId` into a safe account namespace before loading the desktop. Fresh Web2 storage keeps normalized workspaces, nodes, settings, operations, retained versions, preferences, sessions, apps, app data, and associations in one account database while OPFS stores content-addressed chunks and approved archives. Frontend-only mode makes no auth request and uses this fresh namespace unconditionally. Synchronized production keeps its deployed storage path until Web2 server activation; logout preserves every account namespace.

This pre-release storage cutover intentionally starts each namespace empty once. On first startup, Hiraya acquires the retired SQLite owner lock, removes that namespace's old SQLite and OPFS payload/cache data, clears its active desktop selection, and records a versioned reset marker. If an older tab still owns the retired storage, startup asks the user to close older tabs rather than deleting data concurrently.

Offline mutations update the IndexedDB desktop aggregate and append a strict persisted schema version 1 outbox record atomically. These logical records remain stable across the wire-schema cut. Every record has a `desktopId`; `catalogId` is nullable only before the first successful desktop-list fetch. Replay translates logical operations to generic `entry.create`, `entry.patch`, `entry.content.write`, `entry.trash`, `entry.restore`, `entry.purge`, or `entry.transfer` operations without rewriting operation IDs, staged blobs, causal keys, or conflict records. Shared writes require an online connection. File bytes are staged in OPFS before metadata is exposed; downloaded bytes are accepted only for the matching catalog, desktop, entry revision, and size. The browser cache and outbox are not a backup.

User mutations return after that durable local commit; server replay, upload, reconciliation, and retry are never part of the interaction's critical path. See [Background Synchronization Decision](docs/background-synchronization.md) for the canonical interaction contract, failure semantics, and exceptions.

Replay posts generic operations to `/api/desktops/{anchorDesktopId}/entries/transactions` with the durable outbox identity. Transactions that need bytes return upload targets; the client PUTs staged content directly, commits through the transaction endpoint, and best-effort cancels an uncommitted preparation after failure. Layout, editor settings, theme selection, theme definitions, and theme packages use their protected system-entry identities while preserving the logical web projection. `GET /api/desktops/{desktopId}/entries/{entryId}/content?revision=...` always returns a short-lived direct-access descriptor; media previews add `purpose=preview`. Public content uses the equivalent publication-scoped route. Presigned targets must be absolute HTTPS URLs, except loopback HTTP in local development, and are fetched without browser credentials. Authenticated targets must match the session's `directBlobOrigin`; anonymous public targets receive the same URL and header safety validation without session metadata. Targets, headers, and object-store credentials are never persisted.

## Routes And Areas

The canonical pathname is `/desktops/{desktopId}/areas/{column}/{row}` with optional explorer, file, properties, or settings suffixes. Routing uses the browser History API; hashes are not routes. The transient `?open=` file-path query is replaced with the corresponding canonical file pathname after resolution. The static host must serve `index.html` for direct requests to desktop paths; GitHub Pages does not provide the required fallback. Root coordinates form one continuous canvas; visible areas are derived segments and are not persisted.

## Portable Data

Seeded packages, clipboard archives, window sessions, and browser history use strict schema version 1 envelopes. Entries require `createdAt`. Earlier versions and aliases are intentionally rejected.

Set `HIRAYA_SEEDED_DIR` to a package directory containing `manifest.json` and referenced content:

```sh
HIRAYA_SEEDED_DIR=examples/seeded bun run build
```

Seeded content is used only for a fresh frontend-only origin. Synchronized installs converge from the server catalog.

Web2 installs ordinary apps through account app APIs rather than an administrator App Store desktop. Verify the trusted system apps in a deployed image with:

```sh
bun run apps:system:verify -- https://hiraya.example
```
