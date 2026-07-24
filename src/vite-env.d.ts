/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

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
  import type { HirayaAppManifestV1 } from "@hiraya/apps-contracts";

  const catalog: readonly { slug: string; archivePath: string; manifest: HirayaAppManifestV1 }[];
  export default catalog;
}
