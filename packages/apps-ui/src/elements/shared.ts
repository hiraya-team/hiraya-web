const FallbackHTMLElement = class {} as unknown as typeof HTMLElement;

export const HTMLElementBase = globalThis.HTMLElement ?? FallbackHTMLElement;

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

export function defineElement(name: string, constructor: CustomElementConstructor): void {
  if (typeof customElements !== "undefined" && !customElements.get(name)) customElements.define(name, constructor);
}

export function hirayaEvent<T>(target: EventTarget, name: string, detail?: T, cancelable = false): boolean {
  return target.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, cancelable, detail }));
}

export function hasBooleanAttribute(element: Element, name: string): boolean {
  return element.hasAttribute(name) && element.getAttribute(name) !== "false";
}

export function setBooleanAttribute(element: Element, name: string, value: boolean): void {
  if (value) element.setAttribute(name, "");
  else element.removeAttribute(name);
}

export function focusableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hidden);
}
