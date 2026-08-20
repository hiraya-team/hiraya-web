/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly HIRAYA_BUILD_TIMESTAMP: string;
  readonly HIRAYA_FRONTEND_ONLY: string;
  readonly HIRAYA_HISTORY_LIMIT: string;
}

declare module "virtual:hiraya-seeded" {
  import type { SeededManifest } from "./lib/seeded-manifest";

  const manifest: SeededManifest | null;
  export default manifest;
}

declare module "virtual:hiraya-system-apps" {
  import type { HirayaAppManifestV2 } from "@hiraya-team/apps-contracts";

  const catalog: readonly { slug: string; archivePath: string; digest: string; size: number; manifest: HirayaAppManifestV2 }[];
  export default catalog;
}

declare module "virtual:hiraya-apps-ui-runtime" {
  import type { SandboxUiRuntime } from "@hiraya/app-runtime";

  const runtime: Readonly<SandboxUiRuntime>;
  export default runtime;
}
