import { isSafeRootRelativePath } from "./auth";
import { isRecord } from "./contracts";
import { accountStorage } from "../platform/storage/account-storage";
import { deleteWeb2ShortLink, fetchWeb2ShortLinks, putWeb2ShortLink } from "../sync/transport";
import { WEB2_SYNC_PROTOCOL } from "../sync/constants";

export type ShortLink = {
  slug: string;
  destinationUrl: string;
  url: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Lists the supported short link keys. */
const SHORT_LINK_KEYS = ["slug", "destinationUrl", "url", "enabled", "createdAt", "updatedAt"] as const;

/** Resolves a value as an absolute URL. */
function absoluteUrl(value: unknown, label: string, httpsOnly = false) {
  if (typeof value !== "string" || value.trim() !== value || !/^https?:\/\//i.test(value)) throw new Error(`A short link contains an invalid ${label}.`);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`A short link contains an invalid ${label}.`); }
  if ((httpsOnly ? url.protocol !== "https:" : url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) throw new Error(`A short link contains an invalid ${label}.`);
  return value;
}

/** Builds the public URL for a short link. */
function publicUrl(value: unknown) {
  if (typeof value === "string" && isSafeRootRelativePath(value)) return value;
  return absoluteUrl(value, "public URL");
}

/** Parses and validates short link. */
export function parseShortLink(value: unknown): ShortLink {
  if (!isRecord(value) || Object.keys(value).length !== SHORT_LINK_KEYS.length || SHORT_LINK_KEYS.some((key) => !(key in value))) throw new Error("A short link has an unsupported format.");
  if (typeof value.slug !== "string" || !value.slug || typeof value.enabled !== "boolean") throw new Error("A short link has an unsupported format.");
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error("A short link contains an invalid timestamp.");
  const url = publicUrl(value.url);
  if (url !== `/r/${value.slug}`) throw new Error("A short link contains an invalid public URL.");
  return { slug: value.slug, destinationUrl: absoluteUrl(value.destinationUrl, "destination URL", true), url, enabled: value.enabled, createdAt: value.createdAt, updatedAt: value.updatedAt };
}

/** Parses and validates short links. */
export function parseShortLinks(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.shortLinks)) throw new Error("The short-links response has an unsupported format.");
  const shortLinks = value.shortLinks.map(parseShortLink);
  if (new Set(shortLinks.map(({ slug }) => slug)).size !== shortLinks.length) throw new Error("The short-links response contains duplicate slugs.");
  return shortLinks;
}

/** Resolves short link URL. */
export function resolveShortLinkUrl(value: string, origin: string) {
  return new URL(value, origin).href;
}

/** Projects a short link into its public representation. */
function projected(value: Awaited<ReturnType<typeof fetchWeb2ShortLinks>>["shortLinks"][number]): ShortLink {
  return { ...value, createdAt: new Date(value.createdAt).toISOString(), updatedAt: new Date(value.updatedAt).toISOString() };
}

/** Lists short links. */
export async function listShortLinks(_fetchImpl?: typeof fetch) {
  void _fetchImpl;
  return (await fetchWeb2ShortLinks(accountStorage().accountId)).shortLinks.map(projected);
}

/** Creates short link. */
export async function createShortLink(input: { slug?: string; destinationUrl: string }, _fetchImpl?: typeof fetch) {
  void _fetchImpl;
  const slug = input.slug ?? `link-${crypto.randomUUID().slice(0, 8)}`;
  await putWeb2ShortLink(accountStorage().accountId, crypto.randomUUID(), { schemaVersion: 1, protocol: WEB2_SYNC_PROTOCOL, slug, destinationUrl: input.destinationUrl, enabled: true });
  return projected((await fetchWeb2ShortLinks(accountStorage().accountId)).shortLinks.find((link) => link.slug === slug)!);
}

/** Updates short link. */
export async function updateShortLink(slug: string, input: { destinationUrl?: string; enabled?: boolean }, _fetchImpl?: typeof fetch) {
  void _fetchImpl;
  const current = (await fetchWeb2ShortLinks(accountStorage().accountId)).shortLinks.find((link) => link.slug === slug);
  if (!current) throw new Error("That short link no longer exists.");
  await putWeb2ShortLink(accountStorage().accountId, crypto.randomUUID(), { schemaVersion: 1, protocol: WEB2_SYNC_PROTOCOL, slug, destinationUrl: input.destinationUrl ?? current.destinationUrl, enabled: input.enabled ?? current.enabled });
  return projected((await fetchWeb2ShortLinks(accountStorage().accountId)).shortLinks.find((link) => link.slug === slug)!);
}

/** Removes short link. */
export async function deleteShortLink(slug: string, _fetchImpl?: typeof fetch) {
  void _fetchImpl;
  await deleteWeb2ShortLink(accountStorage().accountId, slug, crypto.randomUUID());
}
