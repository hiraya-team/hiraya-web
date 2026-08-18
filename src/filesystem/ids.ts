const STABLE_ID = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;

export function parseStableId(value: unknown, message = "A stable ID is invalid.") {
  if (typeof value !== "string" || !STABLE_ID.test(value)) throw new Error(message);
  return value;
}

export async function sha256Hex(bytes: BufferSource) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function storageNamespaceHash(storageId: string) {
  return sha256Hex(new TextEncoder().encode(parseStableId(storageId, "The storage ID is invalid.")));
}
