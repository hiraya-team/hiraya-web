import { execFileSync } from "node:child_process";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inspectAppArchive } from "@hiraya-team/app-cli";
import { APP_CATALOG_SCHEMA_VERSION, APPS_PROTOCOL_VERSION, parseAppCatalog, type AppCatalog, type AppCatalogRelease, type HirayaAppManifestV2 } from "@hiraya-team/apps-contracts";
import { ACTIVE_SYSTEM_APP_IDS, RETIRED_SYSTEM_APP_IDS } from "../src/apps/system-app-ids";

const CATALOG_FILE = "hiraya.apps.json";
const ACTIVE_SYSTEM_APP_ID_SET = new Set<string>(Object.values(ACTIVE_SYSTEM_APP_IDS));
const RETIRED_SYSTEM_APP_ID_SET = new Set<string>(Object.values(RETIRED_SYSTEM_APP_IDS));

export function catalogWithRelease(catalog: AppCatalog, kind: "store" | "system", slug: string, digest: string, size: number, manifest: HirayaAppManifestV2) {
  if (kind === "system" && !ACTIVE_SYSTEM_APP_ID_SET.has(manifest.id)) throw new Error("That app ID is not supported as an active trusted system app by the target Hiraya runtime.");
  const version = manifest.version.replace(/[^0-9A-Za-z.-]+/g, "-");
  const release: AppCatalogRelease = { kind, slug, fileName: `${slug}-${version}-${digest.slice(0, 12)}.hiraya.app`, digest, size, manifest };
  const current = catalog.releases.find((item) => item.manifest.id === manifest.id);
  if (current?.manifest.version === manifest.version && current.digest !== digest) throw new Error(`${manifest.id}@${manifest.version} was already published with different bytes.`);
  return parseAppCatalog({ schemaVersion: APP_CATALOG_SCHEMA_VERSION, releases: [...catalog.releases.filter((item) => item.manifest.id !== manifest.id), release].toSorted((left, right) => left.manifest.id.localeCompare(right.manifest.id)) });
}

export function catalogWithoutRetiredSystemRelease(catalog: AppCatalog, slug: string) {
  const current = catalog.releases.find((item) => item.kind === "system" && item.slug === slug);
  if (!current || !RETIRED_SYSTEM_APP_ID_SET.has(current.manifest.id)) throw new Error("That slug is not an active retired system app release.");
  return parseAppCatalog({ ...catalog, releases: catalog.releases.filter((item) => item !== current) });
}

async function requireCompatibleRuntime(server: string) {
  const response = await fetch(new URL("api/health", server.endsWith("/") ? server : `${server}/`), { redirect: "error" });
  if (!response.ok) throw new Error(`Hiraya runtime compatibility could not be read (${response.status}).`);
  const value = (await response.json() as { appRuntime?: Record<string, unknown> }).appRuntime ?? {};
  if (value.catalogSchema !== APP_CATALOG_SCHEMA_VERSION || value.manifestSchema !== 2 || value.uiRuntime !== 1 || value.protocolVersion !== APPS_PROTOCOL_VERSION) throw new Error("The target Hiraya runtime does not support this app release contract.");
}

async function releaseApp(server: string, storeRoot: string, kind: "store" | "system", slug: string, archivePath: string) {
  await requireCompatibleRuntime(server);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Release slug must contain lowercase words separated by hyphens.");
  const root = resolve(storeRoot);
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("App Store root must be a real synchronized directory.");
  const archiveStat = await lstat(archivePath);
  if (archiveStat.isSymbolicLink() || !archiveStat.isFile()) throw new Error("App release must be a regular archive file.");
  const archive = new Uint8Array(await readFile(archivePath));
  const inspection = await inspectAppArchive(archive);
  execFileSync("hiraya", ["sync", "once", "--require-clean", "--root", root], { stdio: "inherit" });
  const catalogPath = join(root, CATALOG_FILE);
  let catalog: AppCatalog = { schemaVersion: APP_CATALOG_SCHEMA_VERSION, releases: [] };
  try { catalog = parseAppCatalog(JSON.parse(await readFile(catalogPath, "utf8"))); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const next = catalogWithRelease(catalog, kind, slug, inspection.digest, archive.byteLength, inspection.manifest);
  const release = next.releases.find((item) => item.manifest.id === inspection.manifest.id)!;
  const releasePath = join(root, release.fileName);
  try {
    await writeFile(releasePath, archive, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !Buffer.from(await readFile(releasePath)).equals(archive)) throw error;
  }
  execFileSync("hiraya", ["sync", "once", "--require-clean", "--root", root], { stdio: "inherit" });
  execFileSync("hiraya", ["sync", "verify", release.fileName, "--root", root], { stdio: "inherit" });
  const temporary = join(root, `.${CATALOG_FILE}.${process.pid}.tmp`);
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, catalogPath);
  execFileSync("hiraya", ["sync", "once", "--require-clean", "--root", root], { stdio: "inherit" });
  execFileSync("hiraya", ["sync", "verify", CATALOG_FILE, release.fileName, "--root", root], { stdio: "inherit" });
  console.log(`Published ${inspection.manifest.id}@${inspection.manifest.version} as ${release.fileName}`);
}

async function retireSystemApp(server: string, storeRoot: string, slug: string) {
  await requireCompatibleRuntime(server);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Release slug must contain lowercase words separated by hyphens.");
  const root = resolve(storeRoot);
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("App Store root must be a real synchronized directory.");
  execFileSync("hiraya", ["sync", "once", "--require-clean", "--root", root], { stdio: "inherit" });
  const catalogPath = join(root, CATALOG_FILE);
  const catalog = parseAppCatalog(JSON.parse(await readFile(catalogPath, "utf8")));
  const next = catalogWithoutRetiredSystemRelease(catalog, slug);
  const temporary = join(root, `.${CATALOG_FILE}.${process.pid}.tmp`);
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, catalogPath);
  execFileSync("hiraya", ["sync", "once", "--require-clean", "--root", root], { stdio: "inherit" });
  execFileSync("hiraya", ["sync", "verify", CATALOG_FILE, "--root", root], { stdio: "inherit" });
  console.log(`Retired system app release ${slug}; its historical archive was preserved.`);
}

function usage(): never {
  console.error("Usage: bun run apps:release -- --server URL --store-root DIR (--kind <store|system> --slug SLUG APP.hiraya.app | --retire-system SLUG)");
  process.exit(2);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const server = value("--server");
  const storeRoot = value("--store-root");
  const kind = value("--kind");
  const slug = value("--slug");
  const retireSlug = value("--retire-system");
  const consumed = new Set(args.flatMap((arg, index) => arg.startsWith("--") ? [index, index + 1] : []));
  const archive = args.find((_, index) => !consumed.has(index));
  if (!server || !storeRoot) usage();
  if (retireSlug ? kind || slug || archive : kind !== "store" && kind !== "system" || !slug || !archive || !archive.endsWith(".hiraya.app")) usage();
  try {
    if (retireSlug) await retireSystemApp(server, storeRoot, retireSlug);
    else await releaseApp(server, storeRoot, kind as "store" | "system", slug!, archive!);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
