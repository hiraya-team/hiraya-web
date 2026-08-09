import { namesMatch } from "./entry-validation";

export const APP_SHORTCUT_MIME_TYPE = "application/vnd.hiraya.app-shortcut+json";
export const APP_SHORTCUT_MAX_BYTES = 4_096;

export type AppShortcut = Readonly<{ appId: string }>;

function parseAppId(value: unknown) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || [...value].some((character) => (character.codePointAt(0) ?? 0) < 32)) {
    throw new Error("This application shortcut has an invalid app ID.");
  }
  return value;
}

export function createAppShortcut(appId: string) {
  return `${JSON.stringify({ schemaVersion: 1, appId: parseAppId(appId) })}\n`;
}

export function parseAppShortcut(content: string): AppShortcut {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("This application shortcut is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("This application shortcut is invalid.");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => key !== "schemaVersion" && key !== "appId") || item.schemaVersion !== 1) throw new Error("This application shortcut uses an unsupported format.");
  return { appId: parseAppId(item.appId) };
}

export function availableAppShortcutName(appName: string, existingNames: readonly string[]) {
  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1 ? appName : `${appName} (${suffix})`;
    if (!existingNames.some((name) => namesMatch(name, candidate))) return candidate;
  }
}
