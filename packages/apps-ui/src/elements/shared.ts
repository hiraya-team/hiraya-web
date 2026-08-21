/** Provides an HTMLElement fallback for non-browser environments. */
const FallbackHTMLElement = class {} as unknown as typeof HTMLElement;

/** Provides the native HTMLElement base when available. */
export const HTMLElementBase = globalThis.HTMLElement ?? FallbackHTMLElement;

/** Defines shared custom-element foundation styles. */
export const elementStyles = `
  :host { box-sizing: border-box; color: var(--hiraya-text, #f5eedc); font: inherit; }
  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button, input, select, textarea { color: inherit; font: inherit; }
  :focus-visible { outline: 3px solid var(--hiraya-focus, #fff); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
  }
`;

/** Defines a custom element unless it is already registered. */
export function defineElement(name: string, constructor: CustomElementConstructor): void {
  if (typeof customElements !== "undefined" && !customElements.get(name)) customElements.define(name, constructor);
}

/** Dispatches a composed Hiraya custom event. */
export function hirayaEvent<T>(target: EventTarget, name: string, detail?: T, cancelable = false): boolean {
  return target.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, cancelable, detail }));
}

/** Reports whether a Boolean attribute is enabled. */
export function hasBooleanAttribute(element: Element, name: string): boolean {
  return element.hasAttribute(name) && element.getAttribute(name) !== "false";
}

/** Sets boolean attribute. */
export function setBooleanAttribute(element: Element, name: string, value: boolean): void {
  if (value) element.setAttribute(name, "");
  else element.removeAttribute(name);
}

/** Returns the visible, focusable descendants of a node. */
export function focusableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hidden);
}
