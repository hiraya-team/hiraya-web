import type { DesktopEntry } from "../types";
import { foldEntryName, normalizeEntryName } from "./contracts";

export function validateEntryName(value: string) {
  const name = value.trim();
  if (!name) throw new Error("Enter a name.");
  if (name === "." || name === "..") throw new Error("The names . and .. are reserved.");
  if (name.includes("/") || name.includes("\\")) throw new Error("A name cannot contain slashes.");
  if ([...name].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  })) throw new Error("A name cannot contain control characters.");
  if ([...name].length > 180) throw new Error("A name cannot exceed 180 characters.");
  return normalizeEntryName(value);
}

export function namesMatch(left: string, right: string) {
  return foldEntryName(left) === foldEntryName(right);
}

export function assertUniqueName(entries: DesktopEntry[], name: string, parentId: string | null, exceptId?: string) {
  const duplicate = entries.some(
    (entry) => entry.id !== exceptId && entry.parentId === parentId && namesMatch(entry.name, name),
  );
  if (duplicate) throw new Error(`An entry named “${name}” already exists in this folder.`);
}
