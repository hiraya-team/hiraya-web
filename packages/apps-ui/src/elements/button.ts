import { elementStyles, hasBooleanAttribute, HTMLElementBase, setBooleanAttribute } from "./shared";

export type HirayaButtonVariant = "secondary" | "primary" | "quiet" | "danger";

/** Implements the Hiraya button. */
export class HirayaButton extends HTMLElementBase {
  static readonly observedAttributes = ["variant", "disabled", "loading", "aria-label", "title"];

  readonly #button: HTMLButtonElement;

  /** Creates a hiraya button instance. */
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${elementStyles}
      :host { display: inline-block; }
      button { display: inline-flex; min-block-size: var(--hiraya-control-height, 2.25rem); align-items: center; justify-content: center; gap: var(--hiraya-space-2, .5rem); padding: .4rem .75rem; border: var(--hiraya-border-width, 1px) solid var(--hiraya-border, #526a60); border-radius: var(--hiraya-radius-control, .45rem); color: var(--hiraya-text, #f5eedc); background: var(--hiraya-surface-elevated, #20352d); font-size: var(--hiraya-font-size-control, .875rem); cursor: pointer; transition: border-color var(--hiraya-motion-fast, 120ms), background var(--hiraya-motion-fast, 120ms), transform var(--hiraya-motion-fast, 120ms); }
      button:hover:not(:disabled) { border-color: var(--hiraya-accent, #e2aa52); background: var(--hiraya-surface-hover, #294238); }
      button:active:not(:disabled) { transform: translateY(1px); }
      button:disabled { cursor: not-allowed; opacity: .55; }
      button.primary { border-color: var(--hiraya-accent, #e2aa52); color: var(--hiraya-accent-text, #172018); background: var(--hiraya-accent, #e2aa52); font-weight: var(--hiraya-font-weight-control, 650); }
      button.quiet { border-color: transparent; background: transparent; }
      button.danger { border-color: color-mix(in srgb, var(--hiraya-danger, #ff8175) 55%, var(--hiraya-border, #526a60)); color: var(--hiraya-danger, #ff8175); background: var(--hiraya-danger-surface, #402b28); }
      .loading { inline-size: .85rem; block-size: .85rem; border: 2px solid currentColor; border-inline-end-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; }
      @keyframes spin { to { transform: rotate(1turn); } }
    </style><button part="button" type="button"><span class="loading" part="loading-indicator" hidden aria-hidden="true"></span><slot name="icon-start"></slot><span part="label"><slot></slot></span><slot name="icon-end"></slot></button>`;
    this.#button = root.querySelector("button")!;
  }

  /** Initializes the element when it joins the document. */
  connectedCallback(): void { this.#sync(); }
  /** Synchronizes state after an observed attribute changes. */
  attributeChangedCallback(): void { this.#sync(); }

  /** Reports whether the button is disabled. */
  get disabled(): boolean { return hasBooleanAttribute(this, "disabled"); }
  /** Sets whether the button is disabled. */
  set disabled(value: boolean) { setBooleanAttribute(this, "disabled", value); }
  /** Reports whether the button is loading. */
  get loading(): boolean { return hasBooleanAttribute(this, "loading"); }
  /** Sets whether the button is loading. */
  set loading(value: boolean) { setBooleanAttribute(this, "loading", value); }
  /** Returns the button's visual variant. */
  get variant(): HirayaButtonVariant { return (this.getAttribute("variant") as HirayaButtonVariant | null) ?? "secondary"; }
  /** Sets the button's visual variant. */
  set variant(value: HirayaButtonVariant) { this.setAttribute("variant", value); }
  /** Moves focus to this element. */
  focus(options?: FocusOptions): void { this.#button.focus(options); }

  /** Synchronizes the rendered state with current properties. */
  #sync(): void {
    if (!this.#button) return;
    const unavailable = this.disabled || this.loading;
    this.#button.disabled = unavailable;
    this.#button.className = this.variant;
    this.#button.setAttribute("aria-busy", String(this.loading));
    const label = this.getAttribute("aria-label");
    if (label) this.#button.setAttribute("aria-label", label);
    else this.#button.removeAttribute("aria-label");
    const title = this.getAttribute("title");
    if (title) this.#button.title = title;
    else this.#button.removeAttribute("title");
    const indicator = this.shadowRoot?.querySelector<HTMLElement>(".loading");
    if (indicator) indicator.hidden = !this.loading;
  }

}
