const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:/i;
const BLOCKED_SCHEMES = new Set(["javascript", "vbscript", "data", "blob", "file", "filesystem"]);

export type InternetShortcut = {
  url: string;
  scheme: string;
};

export const INTERNET_SHORTCUT_MIME_TYPE = "application/internet-shortcut";

export function parseShortcutUrl(value: string): InternetShortcut {
  const url = value.trim();
  if (!url || !ABSOLUTE_URL.test(url)) throw new Error("Enter a complete URL including its scheme, such as https://.");
  if ([...url].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  })) throw new Error("Enter a URL without control characters.");
  try {
    new URL(url);
  } catch {
    throw new Error("Enter a valid URL.");
  }
  const scheme = url.slice(0, url.indexOf(":")).toLowerCase();
  if (BLOCKED_SCHEMES.has(scheme)) throw new Error(`The ${scheme}: scheme cannot be opened by Hiraya.`);
  return { url, scheme };
}

export function createInternetShortcut(value: string) {
  const shortcut = parseShortcutUrl(value);
  const hostname = new URL(shortcut.url).hostname;
  const stem = [...(hostname || shortcut.scheme)].slice(0, 176).join("");
  return {
    ...shortcut,
    name: `${stem}.url`,
    content: `[InternetShortcut]\r\nURL=${shortcut.url}\r\n`,
  };
}

export function parseInternetShortcut(content: string): InternetShortcut {
  return parseShortcutUrl(readInternetShortcutUrl(content));
}

export function readInternetShortcutUrl(content: string) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  let inShortcutSection = false;
  for (const line of lines) {
    const section = line.trim().match(/^\[([^\]]+)]$/);
    if (section) {
      inShortcutSection = section[1].trim().toLowerCase() === "internetshortcut";
      continue;
    }
    if (!inShortcutSection) continue;
    const setting = line.match(/^\s*url\s*=\s*(.*)$/i);
    if (setting) return setting[1].trim();
  }
  throw new Error("This file does not contain a URL in an [InternetShortcut] section.");
}
