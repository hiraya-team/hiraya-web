export const WIRE_SCHEMA_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isValidCatalogId(value: unknown): value is string {
  if (typeof value !== "string" || !value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || new TextEncoder().encode(value).byteLength > 180) return false;
  return ![...value].some((character) => { const codePoint = character.codePointAt(0) ?? 0; return codePoint < 32 || codePoint === 127; });
}

export class UpgradeRequiredError extends Error {
  constructor(readonly schemaVersion: number) {
    super(`This Hiraya server uses schema version ${schemaVersion}. Update Hiraya before synchronizing.`);
    this.name = "UpgradeRequiredError";
  }
}

export class AuthorityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorityValidationError";
  }
}

export function parseAuthorityIdentity(value: unknown, source: string, expectedCatalogId?: string | null) {
  if (!isRecord(value)) throw new AuthorityValidationError(`${source} has an unsupported format.`);
  if (!Number.isSafeInteger(value.schemaVersion) || (value.schemaVersion as number) < 0) throw new AuthorityValidationError(`${source} has an invalid schema version.`);
  if (value.schemaVersion !== WIRE_SCHEMA_VERSION) throw new UpgradeRequiredError(value.schemaVersion as number);
  if (!isValidCatalogId(value.catalogId)) throw new AuthorityValidationError(`${source} has an invalid catalog identity.`);
  if (expectedCatalogId && value.catalogId !== expectedCatalogId) throw new AuthorityValidationError(`${source} belongs to a different catalog.`);
  return { schemaVersion: WIRE_SCHEMA_VERSION, catalogId: value.catalogId } as const;
}
