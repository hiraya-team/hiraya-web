import type { DesktopEntry, FileEntry } from "../types";
import { APP_PERMISSIONS } from "./permissions";
import type { FileAssociation, InstalledApp } from "./installed-apps";
import { installedAppAcceptsFile, installedAppAcceptsMatcher, installedAppIsAvailable, installedAppMatchesSavedIdentity } from "./installed-apps";
import { SYSTEM_APP_IDS } from "./system-app-ids";
import type { SystemAppTarget } from "./types";
import { APP_SHORTCUT_MIME_TYPE } from "../lib/app-shortcut";

export type AssociationResolution = Readonly<{ app: InstalledApp; preferredUnavailable?: { appId: string; matcher: string } }>;

export type ReservedFileHandler = "app-package" | "app-shortcut" | "internet-shortcut";

/** Matches extensions that are safe to open as editable text. */
const EDITABLE_TEXT_EXTENSION = /\.(?:css|csv|html?|hsh|js|jsx|json|log|markdown|md|ts|tsx|txt|xml|ya?ml)$/i;

/** Describes the built-in file-handler precedence shown to users. */
export const SYSTEM_FILE_DEFAULTS = [
  { label: "Hiraya Scenes", matcher: ".hiraya.scene, application/vnd.hiraya.scene+zip", appId: SYSTEM_APP_IDS.textEditor },
  { label: "Text and source files", matcher: "text/*", appId: SYSTEM_APP_IDS.textEditor },
  { label: "Shell scripts", matcher: ".hsh", appId: SYSTEM_APP_IDS.terminal },
  { label: "Markdown", matcher: ".md, .markdown", appId: SYSTEM_APP_IDS.mediaViewer },
  { label: "Documents and media", matcher: ".docx, .rtf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/rtf, application/pdf, audio/*, video/*", appId: SYSTEM_APP_IDS.mediaViewer },
  { label: "Images", matcher: "image/*", appId: SYSTEM_APP_IDS.imageViewer },
  { label: "Other files", matcher: "fallback", appId: SYSTEM_APP_IDS.fileViewer },
] as const;

/** Returns the privileged handler reserved for a special file type. */
export function reservedFileHandler(file: Pick<FileEntry, "name" | "mimeType">): ReservedFileHandler | null {
  const name = file.name.toLowerCase();
  if (file.mimeType.split(";", 1)[0].trim().toLowerCase() === APP_SHORTCUT_MIME_TYPE) return "app-shortcut";
  if (name.endsWith(".hiraya.app")) return "app-package";
  if (name.endsWith(".url")) return "internet-shortcut";
  return null;
}

/** Returns extension matchers from most to least specific. */
function extensionMatchers(name: string): string[] {
  const lower = name.toLowerCase();
  const matchers: string[] = [];
  for (let index = lower.indexOf("."); index >= 0; index = lower.indexOf(".", index + 1)) {
    const matcher = lower.slice(index);
    if (/^\.[a-z0-9][a-z0-9._+-]*$/.test(matcher)) matchers.push(matcher);
  }
  return matchers.sort((a, b) => b.length - a.length);
}

/** Builds ordered extension and MIME candidates for association lookup. */
export function associationCandidates(file: Pick<FileEntry, "name" | "mimeType">): string[] {
  const mime = file.mimeType.split(";", 1)[0].trim().toLowerCase();
  const wildcard = mime.includes("/") ? `${mime.split("/", 1)[0]}/*` : "";
  return [...new Set([...extensionMatchers(file.name), mime, ...(wildcard ? [wildcard] : [])])];
}

/** Lists available installed apps that can read a file. */
export function matchingInstalledApps(apps: readonly InstalledApp[], entries: readonly DesktopEntry[], file: Pick<FileEntry, "name" | "mimeType">): InstalledApp[] {
  if (reservedFileHandler(file)) return [];
  return apps.filter((app) => installedAppIsAvailable(app, entries) && app.manifest.permissions.includes(APP_PERMISSIONS.filesRead) && installedAppAcceptsFile(app, file));
}

/** Reports whether a file should use Markdown handling. */
export function isMarkdownFile(file: Pick<FileEntry, "name" | "mimeType">): boolean {
  const mime = file.mimeType.split(";", 1)[0].trim().toLowerCase();
  const name = file.name.toLowerCase();
  return name.endsWith(".md") || name.endsWith(".markdown") || mime === "text/markdown";
}

/** Selects the bundled fallback app for a file's type. */
export function systemDefaultAppId(file: Pick<FileEntry, "name" | "mimeType">): string {
  const mime = file.mimeType.split(";", 1)[0].trim().toLowerCase();
  const name = file.name.toLowerCase();
  if (name.endsWith(".hiraya.scene") || mime === "application/vnd.hiraya.scene+zip") return SYSTEM_APP_IDS.textEditor;
  if (mime.startsWith("text/")) return SYSTEM_APP_IDS.textEditor;
  if (name.endsWith(".hsh")) return SYSTEM_APP_IDS.terminal;
  if (isMarkdownFile(file)) return SYSTEM_APP_IDS.mediaViewer;
  if (name.endsWith(".docx") || name.endsWith(".rtf") || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || mime === "application/rtf") return SYSTEM_APP_IDS.mediaViewer;
  if ((!mime || mime === "application/octet-stream") && EDITABLE_TEXT_EXTENSION.test(name)) return SYSTEM_APP_IDS.textEditor;
  if (mime.startsWith("image/")) return SYSTEM_APP_IDS.imageViewer;
  if (mime === "application/pdf" || mime.startsWith("audio/") || mime.startsWith("video/")) return SYSTEM_APP_IDS.mediaViewer;
  return SYSTEM_APP_IDS.fileViewer;
}

/** Resolves user associations and system defaults to an available app. */
export function resolveFileApp(file: Pick<FileEntry, "name" | "mimeType">, apps: readonly InstalledApp[], entries: readonly DesktopEntry[], associations: readonly FileAssociation[]): AssociationResolution | null {
  if (reservedFileHandler(file)) return null;
  const available = new Map(apps.filter((app) => installedAppIsAvailable(app, entries) && app.manifest.permissions.includes(APP_PERMISSIONS.filesRead) && installedAppAcceptsFile(app, file)).map((app) => [app.appId, app]));
  let unavailable: AssociationResolution["preferredUnavailable"];
  for (const matcher of associationCandidates(file)) {
    const preference = associations.find((item) => item.matcher === matcher);
    if (!preference) continue;
    const app = available.get(preference.appId);
    if (app && !installedAppAcceptsMatcher(app, matcher)) continue;
    if (app) return { app };
    unavailable ??= { appId: preference.appId, matcher };
  }
  const defaultId = systemDefaultAppId(file);
  const app = available.get(defaultId) ?? available.get(SYSTEM_APP_IDS.fileViewer);
  return app ? { app, ...(unavailable ? { preferredUnavailable: unavailable } : {}) } : null;
}

/** Restores a saved file app only when its approved identity still matches. */
export function resolveRestoredFileApp(file: Pick<FileEntry, "name" | "mimeType">, apps: readonly InstalledApp[], entries: readonly DesktopEntry[], associations: readonly FileAssociation[], saved: Pick<SystemAppTarget, "appId" | "source" | "digest" | "permissions">): AssociationResolution | null {
  const current = resolveFileApp(file, apps, entries, associations);
  if (!current || current.app.appId !== saved.appId || !saved.digest) return current;
  return installedAppMatchesSavedIdentity(current.app, saved) ? current : null;
}
