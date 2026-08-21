import { elementStyles, hasBooleanAttribute, hirayaEvent, HTMLElementBase, setBooleanAttribute } from "./shared";

/** Implements the Hiraya selection toolbar. */
export class HirayaSelectionToolbar extends HTMLElementBase {
  static readonly observedAttributes = ["count", "mode", "label"];

  readonly #toolbar: HTMLElement;
  readonly #summary: HTMLElement;
  readonly #countButton: HTMLButtonElement;
  readonly #selecting: HTMLElement;
  readonly #selectingCount: HTMLElement;
  readonly #status: HTMLElement;

  /** Creates a hiraya selection toolbar instance. */
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${elementStyles}
      :host { display: block; min-inline-size: 0; }
      [role="toolbar"] { display: flex; min-block-size: var(--hiraya-touch-target, 2.75rem); min-inline-size: 0; align-items: center; gap: var(--hiraya-space-2, .5rem); padding: .35rem .7rem; border-block-start: 1px solid var(--hiraya-border, #526a60); background: var(--hiraya-surface, #172722); }
      .summary { display: flex; min-inline-size: 0; align-items: center; }
      .actions { display: flex; min-inline-size: 0; flex: 1; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--hiraya-space-2, .5rem); }
      button, .selecting { min-block-size: var(--hiraya-control-height, 2.25rem); border-radius: var(--hiraya-radius-control, .45rem); }
      button { display: inline-flex; align-items: center; justify-content: center; padding: .25rem .65rem; border: var(--hiraya-border-width, 1px) solid var(--hiraya-border, #526a60); color: var(--hiraya-text, #f5eedc); background: var(--hiraya-surface-elevated, #20352d); cursor: pointer; transition: border-color var(--hiraya-motion-fast, 120ms), background var(--hiraya-motion-fast, 120ms), transform var(--hiraya-motion-fast, 120ms); }
      button:hover { border-color: var(--hiraya-accent, #e2aa52); background: var(--hiraya-surface-hover, #294238); }
      button:active { transform: translateY(1px); }
      .selecting { display: inline-flex; align-items: center; gap: var(--hiraya-space-2, .5rem); padding: .25rem .65rem; color: var(--hiraya-text-muted, #aabbb4); background: var(--hiraya-surface-selected, #314438); font-size: var(--hiraya-font-size-control, .875rem); }
      .selecting strong { color: var(--hiraya-text, #f5eedc); font-variant-numeric: tabular-nums; }
      .sr-only { position: absolute; inline-size: 1px; block-size: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
      @media (max-width: 32.5rem) { [role="toolbar"] { align-items: stretch; flex-direction: column; } .actions { justify-content: flex-start; } }
    </style><div part="toolbar" role="toolbar"><div class="summary" part="summary"><slot name="summary"><button part="mode-button" type="button"></button><span class="selecting" part="mode-status"><span>Selecting</span><strong></strong></span></slot></div><div class="actions" part="actions"><slot name="actions"></slot></div><span class="sr-only" role="status" aria-live="polite" aria-atomic="true"></span></div>`;
    this.#toolbar = root.querySelector<HTMLElement>("[role=toolbar]")!;
    this.#summary = root.querySelector<HTMLElement>(".summary")!;
    this.#countButton = root.querySelector<HTMLButtonElement>("button")!;
    this.#selecting = root.querySelector<HTMLElement>(".selecting")!;
    this.#selectingCount = root.querySelector<HTMLElement>(".selecting strong")!;
    this.#status = root.querySelector<HTMLElement>("[role=status]")!;
    this.#countButton.addEventListener("click", () => {
      hirayaEvent(this, "hiraya-selection-mode-request", { mode: true }, true);
    });
  }

  /** Initializes the element when it joins the document. */
  connectedCallback(): void { this.#sync(); }
  /** Synchronizes state after an observed attribute changes. */
  attributeChangedCallback(): void { this.#sync(); }

  /** Returns the non-negative selection count. */
  get count(): number {
    const value = Number(this.getAttribute("count"));
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  }
  /** Sets the non-negative selection count. */
  set count(value: number) { this.setAttribute("count", String(Math.max(0, Math.trunc(value)) || 0)); }
  /** Reports whether multi-selection mode is active. */
  get mode(): boolean { return hasBooleanAttribute(this, "mode"); }
  /** Sets whether multi-selection mode is active. */
  set mode(value: boolean) { setBooleanAttribute(this, "mode", value); }
  /** Returns the toolbar's accessible label. */
  get label(): string { return this.getAttribute("label") ?? "Selection actions"; }
  /** Sets the toolbar's accessible label. */
  set label(value: string) { this.setAttribute("label", value); }

  /** Synchronizes the rendered state with current properties. */
  #sync(): void {
    if (!this.#toolbar) return;
    const count = this.count;
    const itemLabel = `${count} selected ${count === 1 ? "item" : "items"}`;
    this.#toolbar.setAttribute("aria-label", this.label);
    this.#summary.hidden = count === 0;
    this.#countButton.hidden = this.mode;
    this.#countButton.textContent = String(count);
    this.#countButton.title = "Select multiple items";
    this.#countButton.setAttribute("aria-label", `Select multiple items; ${itemLabel}`);
    this.#selecting.hidden = !this.mode;
    this.#selectingCount.textContent = String(count);
    this.#status.textContent = count === 0 ? "No items selected" : itemLabel;
  }
}
