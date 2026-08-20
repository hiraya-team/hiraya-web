import { createHash } from "node:crypto";
import { inspectAppArchive } from "@hiraya-team/app-cli";
import { parseManifestV2, type HirayaAppManifestV2 } from "@hiraya-team/apps-contracts";
import { SYSTEM_APP_SLUGS } from "./system-apps";

type CatalogApp = Readonly<{
  slug: string;
  archivePath: string;
  digest: string;
  size: number;
  manifest: HirayaAppManifestV2;
}>;

type DeploymentCatalog = Readonly<{ schemaVersion: 1; apps: readonly CatalogApp[] }>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The system app catalog has an unsupported shape.");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  if (Object.keys(value).toSorted().join("\0") !== [...expected].toSorted().join("\0")) throw new Error("The system app catalog has an unsupported shape.");
}

export function parseSystemAppDeploymentCatalog(value: unknown): DeploymentCatalog {
  const root = record(value);
  exactKeys(root, ["schemaVersion", "apps"]);
  if (root.schemaVersion !== 1 || !Array.isArray(root.apps) || root.apps.length !== SYSTEM_APP_SLUGS.length) throw new Error("The system app catalog does not contain the exact bundled app set.");
  const ids = new Set<string>();
  const apps = root.apps.map((value, index) => {
    const item = record(value);
    exactKeys(item, ["slug", "archivePath", "digest", "size", "manifest"]);
    const slug = SYSTEM_APP_SLUGS[index];
    if (item.slug !== slug || item.archivePath !== `system-apps/${slug}.hiraya.app`) throw new Error("The system app catalog does not contain the exact bundled app set.");
    if (typeof item.digest !== "string" || !/^[0-9a-f]{64}$/.test(item.digest)) throw new Error(`The ${slug} digest is invalid.`);
    if (!Number.isSafeInteger(item.size) || (item.size as number) <= 0) throw new Error(`The ${slug} size is invalid.`);
    const manifest = parseManifestV2(item.manifest);
    if (manifest.id !== `app.hiraya.${slug}`) throw new Error(`The ${slug} app ID is invalid.`);
    if (ids.has(manifest.id)) throw new Error("The system app catalog contains duplicate app IDs.");
    ids.add(manifest.id);
    return { slug, archivePath: item.archivePath, digest: item.digest, size: item.size, manifest } as CatalogApp;
  });
  return { schemaVersion: 1, apps };
}

async function responseBytes(url: URL) {
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`${url.pathname} returned HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function verifyDeployedSystemApps(server: string) {
  const base = new URL(server.endsWith("/") ? server : `${server}/`);
  if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("Server must be an HTTP(S) origin or base path without credentials, query, or fragment.");
  const catalogResponse = await fetch(new URL("system-apps/catalog.json", base), { redirect: "error" });
  if (!catalogResponse.ok) throw new Error(`The system app catalog returned HTTP ${catalogResponse.status}.`);
  const catalog = parseSystemAppDeploymentCatalog(await catalogResponse.json());
  for (const app of catalog.apps) {
    const archive = await responseBytes(new URL(app.archivePath, base));
    if (archive.byteLength !== app.size) throw new Error(`${app.slug} does not match its catalog size.`);
    if (createHash("sha256").update(archive).digest("hex") !== app.digest) throw new Error(`${app.slug} does not match its catalog digest.`);
    const inspection = await inspectAppArchive(archive);
    if (inspection.digest !== app.digest || JSON.stringify(inspection.manifest) !== JSON.stringify(app.manifest)) throw new Error(`${app.slug} does not match its catalog manifest.`);
  }
  return catalog.apps;
}

if (import.meta.main) {
  const server = process.argv[2];
  if (!server) {
    console.error("Usage: bun run apps:system:verify -- SERVER");
    process.exit(2);
  }
  try {
    const apps = await verifyDeployedSystemApps(server);
    for (const app of apps) console.log(`${app.slug} ${app.manifest.version} ${app.digest}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
