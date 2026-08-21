/** Defines the wire schema version. */
export const WIRE_SCHEMA_VERSION = 2;

/** Reports whether a value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** Reports whether a value is a valid catalog ID. */
function isValidCatalogId(value: unknown): value is string {
  if (typeof value !== "string" || !value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || new TextEncoder().encode(value).byteLength > 180) return false;
  return ![...value].some((character) => { const codePoint = character.codePointAt(0) ?? 0; return codePoint < 32 || codePoint === 127; });
}

/** Reports upgrade required failures. */
export class UpgradeRequiredError extends Error {
  /** Creates an UpgradeRequiredError instance. */
  constructor(readonly schemaVersion: number) {
    super(`This Hiraya server uses schema version ${schemaVersion}. Update Hiraya before synchronizing.`);
    this.name = "UpgradeRequiredError";
  }
}

/** Reports authority validation failures. */
export class AuthorityValidationError extends Error {
  /** Creates an AuthorityValidationError instance. */
  constructor(message: string) {
    super(message);
    this.name = "AuthorityValidationError";
  }
}

/** Parses and validates authority identity. */
export function parseAuthorityIdentity(value: unknown, source: string, expectedCatalogId?: string | null) {
  if (!isRecord(value)) throw new AuthorityValidationError(`${source} has an unsupported format.`);
  if (!Number.isSafeInteger(value.schemaVersion) || (value.schemaVersion as number) < 0) throw new AuthorityValidationError(`${source} has an invalid schema version.`);
  if (value.schemaVersion !== WIRE_SCHEMA_VERSION) throw new UpgradeRequiredError(value.schemaVersion as number);
  if (!isValidCatalogId(value.catalogId)) throw new AuthorityValidationError(`${source} has an invalid catalog identity.`);
  if (expectedCatalogId && value.catalogId !== expectedCatalogId) throw new AuthorityValidationError(`${source} belongs to a different catalog.`);
  return { schemaVersion: WIRE_SCHEMA_VERSION, catalogId: value.catalogId } as const;
}
