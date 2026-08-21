/** Writes clipboard text. */
export async function writeClipboardText(clipboard: Pick<Clipboard, "writeText">, value: string) {
  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
