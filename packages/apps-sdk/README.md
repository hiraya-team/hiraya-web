# `@hiraya/apps-sdk`

Typed client SDK for apps running inside the Hiraya sandbox.

```ts
import { connectHiraya } from "@hiraya/apps-sdk";

const hiraya = await connectHiraya({ appId: "com.example.notes" });
const launch = await hiraya.app.getLaunchContext();
```

The manifest ID and connection ID must match. Apps communicate with Hiraya only through the negotiated message port. The client exposes `app`, `files`, `dialogs`, `window`, `commands`, `notifications`, `theme`, and app-local `storage` services plus typed host events through `hiraya.on(...)`.

File and folder handles are opaque. For safe updates, retain `FileMetadata.contentRevision` and pass it as `expectedRevision` to `files.write`; resolve `CONFLICT` rather than retrying blindly. Declare every used capability in the app manifest and catch `HirayaSdkError` at user-action boundaries.

`timeoutMs` is a client-local waiting bound and is not sent over protocol version 1. The host independently applies method-specific execution deadlines. A local `TIMEOUT` or post-dispatch `CANCELLED` does not prove that a side-effecting host operation stopped, so do not retry mutations blindly; use revision checks or inspect the resulting state first.

Use `files.readAll` and `files.writeAll` for content that may exceed the RPC request limit. They transfer bounded chunks and `writeAll` publishes only after every chunk is staged. Use `files.readChunk` when the app can process content incrementally. `files.resolve(file, relativePath)` returns a new capability for only the exact resolved target; it does not grant its parent directory.

Use the generated Vanilla TypeScript guide for the complete authoring contract:

```sh
bun packages/app-cli/src/cli.ts init examples/my-app com.example.my-app
```

The generated `AGENTS.md` documents commands, sandbox constraints, lifecycle, permissions, handles, revision-safe writes, themes, storage, errors, security, and testing.
