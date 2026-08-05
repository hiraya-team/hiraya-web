import { isSafeRootRelativePath, requireAuthenticatedResponse } from "./auth";
import { API_ROUTES, authenticatedHeaders } from "./api-routes";
import { isRecord } from "./contracts";

export type ShortLink = {
  slug: string;
  destinationUrl: string;
  url: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const SHORT_LINK_KEYS = ["slug", "destinationUrl", "url", "enabled", "createdAt", "updatedAt"] as const;

function absoluteUrl(value: unknown, label: string, httpsOnly = false) {
  if (typeof value !== "string" || value.trim() !== value || !/^https?:\/\//i.test(value)) throw new Error(`A short link contains an invalid ${label}.`);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`A short link contains an invalid ${label}.`); }
  if ((httpsOnly ? url.protocol !== "https:" : url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) throw new Error(`A short link contains an invalid ${label}.`);
  return value;
}

function publicUrl(value: unknown) {
  if (typeof value === "string" && isSafeRootRelativePath(value)) return value;
  return absoluteUrl(value, "public URL");
}

export function parseShortLink(value: unknown): ShortLink {
  if (!isRecord(value) || Object.keys(value).length !== SHORT_LINK_KEYS.length || SHORT_LINK_KEYS.some((key) => !(key in value))) throw new Error("A short link has an unsupported format.");
  if (typeof value.slug !== "string" || !value.slug || typeof value.enabled !== "boolean") throw new Error("A short link has an unsupported format.");
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error("A short link contains an invalid timestamp.");
  return { slug: value.slug, destinationUrl: absoluteUrl(value.destinationUrl, "destination URL", true), url: publicUrl(value.url), enabled: value.enabled, createdAt: value.createdAt, updatedAt: value.updatedAt };
}

export function parseShortLinks(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.shortLinks)) throw new Error("The short-links response has an unsupported format.");
  const shortLinks = value.shortLinks.map(parseShortLink);
  if (new Set(shortLinks.map(({ slug }) => slug)).size !== shortLinks.length) throw new Error("The short-links response contains duplicate slugs.");
  return shortLinks;
}

export function resolveShortLinkUrl(value: string, origin: string) {
  return new URL(value, origin).href;
}

async function request(input: string, init?: RequestInit, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
  const response = requireAuthenticatedResponse(await fetchImpl(input, { credentials: "same-origin", cache: "no-store", ...init, headers: authenticatedHeaders(init?.headers) }));
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof body?.error === "string" && body.error ? body.error : `The short-link request failed (${response.status}).`);
  }
  return response.status === 204 ? null : response.json();
}

const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export async function listShortLinks(fetchImpl?: typeof fetch) { return parseShortLinks(await request(API_ROUTES.shortLinks, undefined, fetchImpl)); }
export async function createShortLink(input: { slug?: string; destinationUrl: string }, fetchImpl?: typeof fetch) { return parseShortLink(await request(API_ROUTES.shortLinks, { method: "POST", ...json(input) }, fetchImpl)); }
export async function updateShortLink(slug: string, input: { destinationUrl?: string; enabled?: boolean }, fetchImpl?: typeof fetch) { return parseShortLink(await request(API_ROUTES.shortLink(slug), { method: "PATCH", ...json(input) }, fetchImpl)); }
export async function deleteShortLink(slug: string, fetchImpl?: typeof fetch) { await request(API_ROUTES.shortLink(slug), { method: "DELETE" }, fetchImpl); }
