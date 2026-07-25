export type ClipboardOfferState = {
  dismissed: boolean;
  key: string;
  revision: number;
};

export function observeClipboardOffer(current: ClipboardOfferState | null, key: string, force = false): ClipboardOfferState {
  if (!force && current?.key === key) return current;
  return { dismissed: false, key, revision: (current?.revision ?? 0) + 1 };
}

export function dismissClipboardOffer(current: ClipboardOfferState | null): ClipboardOfferState | null {
  return current ? { ...current, dismissed: true } : null;
}
