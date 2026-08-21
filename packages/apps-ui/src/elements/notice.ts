import { elementStyles, hasBooleanAttribute, hirayaEvent, HTMLElementBase } from "./shared";

/** Implements the Hiraya notice. */
export class HirayaNotice extends HTMLElementBase {
  static readonly observedAttributes = ["tone", "dismissible", "live"];
  readonly #notice: HTMLElement;
  readonly #dismiss: HTMLButtonElement;
  /** Creates a hiraya notice instance. */
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${elementStyles}
      :host { display: block; }
      article { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: var(--hiraya-space-3, .75rem); padding: var(--hiraya-space-3, .75rem); border: 1px solid var(--hiraya-border, #526a60); border-radius: var(--hiraya-radius-panel, .75rem); background: var(--hiraya-surface-elevated, #20352d); }
      article.danger { border-color: color-mix(in srgb, var(--hiraya-danger, #ff8175) 55%, var(--hiraya-border, #526a60)); background: var(--hiraya-danger-surface, #402b28); }
      article.accent { border-color: color-mix(in srgb, var(--hiraya-accent, #e2aa52) 55%, var(--hiraya-border, #526a60)); }
      .content { min-inline-size: 0; }
      button { inline-size: var(--hiraya-touch-target, 2.75rem); block-size: var(--hiraya-touch-target, 2.75rem); margin: -.45rem; border: 0; border-radius: var(--hiraya-radius-control, .45rem); color: inherit; background: transparent; cursor: pointer; }
      button:hover { background: var(--hiraya-surface-hover, #294238); }
    </style><article part="notice"><div part="icon"><slot name="icon"></slot></div><div class="content" part="content"><slot name="title"></slot><slot></slot><div part="actions"><slot name="actions"></slot></div></div><button part="dismiss-button" type="button" aria-label="Dismiss" hidden>×</button></article>`;
    this.#notice = root.querySelector("article")!;
    this.#dismiss = root.querySelector("button")!;
    this.#dismiss.addEventListener("click", () => hirayaEvent(this, "hiraya-dismiss", undefined, true));
  }
  /** Initializes the element when it joins the document. */
  connectedCallback(): void { this.#sync(); }
  /** Synchronizes state after an observed attribute changes. */
  attributeChangedCallback(): void { this.#sync(); }
  /** Synchronizes the rendered state with current properties. */
  #sync(): void {
    if (!this.#notice) return;
    this.#notice.className = this.getAttribute("tone") ?? "neutral";
    this.#dismiss.hidden = !hasBooleanAttribute(this, "dismissible");
    const live = this.getAttribute("live");
    if (live) { this.#notice.setAttribute("role", live === "assertive" ? "alert" : "status"); this.#notice.setAttribute("aria-live", live === "assertive" ? "assertive" : "polite"); }
    else { this.#notice.removeAttribute("role"); this.#notice.removeAttribute("aria-live"); }
  }
}
