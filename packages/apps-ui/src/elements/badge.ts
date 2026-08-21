import { elementStyles, HTMLElementBase } from "./shared";

/** Implements the Hiraya badge. */
export class HirayaBadge extends HTMLElementBase {
  static readonly observedAttributes = ["tone"];
  readonly #badge: HTMLSpanElement;

  /** Creates a hiraya badge instance. */
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${elementStyles}
      :host { display: inline-flex; }
      span { display: inline-flex; align-items: center; gap: var(--hiraya-space-1, .25rem); min-block-size: 1.45rem; padding: .1rem .45rem; border: 1px solid var(--hiraya-border, #526a60); border-radius: 999px; color: var(--hiraya-text-muted, #aabbb4); background: var(--hiraya-surface, #172722); font-size: .75rem; line-height: 1.2; }
      .accent, .progress { border-color: color-mix(in srgb, var(--hiraya-accent, #e2aa52) 55%, var(--hiraya-border, #526a60)); color: var(--hiraya-accent, #e2aa52); background: var(--hiraya-surface-selected, #314438); }
      .danger { border-color: color-mix(in srgb, var(--hiraya-danger, #ff8175) 55%, var(--hiraya-border, #526a60)); color: var(--hiraya-danger, #ff8175); background: var(--hiraya-danger-surface, #402b28); }
      .readonly { border-style: dashed; }
      .progress::before { inline-size: .45rem; block-size: .45rem; border-radius: 50%; background: currentColor; content: ""; animation: pulse 1.2s ease-in-out infinite; }
      @keyframes pulse { 50% { opacity: .35; } }
    </style><span part="badge"><slot name="icon"></slot><slot></slot></span>`;
    this.#badge = root.querySelector("span")!;
  }
  /** Initializes the element when it joins the document. */
  connectedCallback(): void { this.#sync(); }
  /** Synchronizes state after an observed attribute changes. */
  attributeChangedCallback(): void { this.#sync(); }
  /** Synchronizes the rendered state with current properties. */
  #sync(): void { if (this.#badge) this.#badge.className = this.getAttribute("tone") ?? "neutral"; }
}
