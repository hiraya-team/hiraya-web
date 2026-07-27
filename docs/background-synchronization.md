# Background Synchronization Decision

Status: Accepted

Date: 2026-07-27

## Context

Hiraya is a desktop environment backed by a server-authoritative catalog. Waiting for server mutation, upload, or reconciliation responses on the interaction path makes routine desktop work depend on network latency and allows one slow operation to delay later actions.

The browser already maintains a projected desktop in OPFS SQLite and a durable ordered outbox. File bytes are staged before projected metadata refers to them, and replay requests have stable idempotency identities.

## Decision

User mutations complete after their local projection and outbox record are durably committed. Server synchronization must never be on the interaction's critical path.

The local mutation queue and synchronization transport queue remain separate:

- Local validation, byte staging, projected metadata, and outbox insertion remain ordered and durable.
- The frontend publishes the committed local projection immediately and returns control to the interaction.
- Ordered server replay, direct uploads, reconciliation, and retries run independently in the background.
- A slow or unavailable server must not delay later local mutations or desktop switching.
- Desktop lifecycle changes cancel stale generation-owned transport so old work cannot affect the newly active desktop.
- Transient failures preserve the projected change and retry automatically. Permanent failures preserve it as blocked until the user retries or discards it.
- UI status distinguishes active background synchronization, queued work waiting to retry, offline local preservation, blocked work, and complete synchronization.

Operations that inherently require remote information, such as downloading uncached bytes or receiving a generated invitation URL, acknowledge the interaction immediately with a pending state. They do not claim successful completion before the required response is available.

## Consequences

- The server remains authoritative in synchronized mode.
- A visible synchronized mutation is locally durable but may not yet exist on the server.
- Reconciliation must reapply all remaining outbox operations over each authoritative snapshot.
- Idempotency headers, outbox ordering, content-before-metadata, complete import validation, and revision-qualified content checks remain mandatory.
- Browser storage loss can still remove changes that have not reached the server, so synchronization status must remain visible and truthful.
- Background delivery is guaranteed while Hiraya is running and resumes from the durable outbox when it reopens. The application does not promise closed-browser delivery through service-worker background sync.

## Verification

Timing-sensitive synchronization tests must prove that:

- Later interactions commit locally while earlier replay requests remain in flight.
- Replay preserves outbox order.
- Desktop switching does not wait for stale transport or uncached reads.
- Stale generation failures cannot alter the new desktop's state or status.
- Transient and permanent failures retain their intended pending or blocked recovery state.
