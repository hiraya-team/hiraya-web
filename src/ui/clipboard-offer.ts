export type ClipboardOfferState = {
  dismissed: boolean;
  key: string;
  revision: number;
};

type ClipboardOfferStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const DISMISSED_CLIPBOARD_OFFER_KEY = "hiraya-dismissed-clipboard-offer-v1";

export function observeClipboardOffer(current: ClipboardOfferState | null, key: string, force = false): ClipboardOfferState {
  if (!force && current?.key === key) return current;
  return { dismissed: false, key, revision: (current?.revision ?? 0) + 1 };
}

export function dismissClipboardOffer(current: ClipboardOfferState | null): ClipboardOfferState | null {
  return current ? { ...current, dismissed: true } : null;
}

export function restoreClipboardOffer(storage: ClipboardOfferStorage | null): ClipboardOfferState | null {
  try {
    const key = storage?.getItem(DISMISSED_CLIPBOARD_OFFER_KEY);
    return key ? { dismissed: true, key, revision: 0 } : null;
  } catch {
    return null;
  }
}

export function persistClipboardOffer(storage: ClipboardOfferStorage | null, current: ClipboardOfferState | null) {
  try {
    if (current?.dismissed) storage?.setItem(DISMISSED_CLIPBOARD_OFFER_KEY, current.key);
    else storage?.removeItem(DISMISSED_CLIPBOARD_OFFER_KEY);
  } catch {
    // Clipboard prompting remains usable when browser storage is unavailable.
  }
}
