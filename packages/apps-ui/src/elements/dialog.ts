import { elementStyles, hasBooleanAttribute, hirayaEvent, HTMLElementBase, setBooleanAttribute } from "./shared";

let dialogSequence = 0;

/** Implements the Hiraya dialog. */
export class HirayaDialog extends HTMLElementBase {
  static readonly observedAttributes = ["open", "dismiss-disabled", "close-label"];
  readonly #dialog: HTMLDialogElement;
  readonly #closeButton: HTMLButtonElement;
  readonly #titleId = `hiraya-dialog-title-${++dialogSequence}`;
  #restoreFocus: HTMLElement | null = null;

  /** Creates a hiraya dialog instance. */
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${elementStyles}
      dialog { inline-size: min(30rem, calc(100vw - 2rem)); max-block-size: calc(100dvh - 2rem); padding: 0; overflow: auto; border: 1px solid var(--hiraya-border, #526a60); border-radius: var(--hiraya-radius-panel, .75rem); color: var(--hiraya-text, #f5eedc); background: var(--hiraya-surface-elevated, #20352d); box-shadow: var(--hiraya-shadow-panel, 0 1rem 3rem rgb(0 0 0 / .3)); }
      dialog::backdrop { background: rgb(0 0 0 / .55); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
      header { display: flex; align-items: center; gap: var(--hiraya-space-3, .75rem); padding: var(--hiraya-space-3, .75rem) var(--hiraya-space-4, 1rem); border-block-end: 1px solid var(--hiraya-border, #526a60); }
      h2 { min-inline-size: 0; flex: 1; margin: 0; font-size: 1.05rem; }
      .body { padding: var(--hiraya-space-4, 1rem); }
      footer { display: flex; justify-content: flex-end; gap: var(--hiraya-space-2, .5rem); padding: var(--hiraya-space-3, .75rem) var(--hiraya-space-4, 1rem); border-block-start: 1px solid var(--hiraya-border, #526a60); }
      button { inline-size: var(--hiraya-touch-target, 2.75rem); block-size: var(--hiraya-touch-target, 2.75rem); border: 0; border-radius: var(--hiraya-radius-control, .45rem); color: inherit; background: transparent; cursor: pointer; }
      button:hover { background: var(--hiraya-surface-hover, #294238); }
    </style><dialog part="dialog" aria-labelledby="${this.#titleId}"><header part="header"><h2 id="${this.#titleId}" part="title"><slot name="title"></slot></h2><button part="close-button" type="button" aria-label="Close">×</button></header><div class="body" part="body"><slot></slot></div><footer part="actions"><slot name="actions"></slot></footer></dialog>`;
    this.#dialog = root.querySelector("dialog")!;
    this.#closeButton = root.querySelector("button")!;
    this.#closeButton.addEventListener("click", () => this.requestClose("close-button"));
    this.#dialog.addEventListener("cancel", (event) => { event.preventDefault(); this.requestClose("escape"); });
    this.#dialog.addEventListener("close", () => this.#closed());
  }

  /** Initializes the element when it joins the document. */
  connectedCallback(): void { this.#sync(); }
  /** Synchronizes state after an observed attribute changes. */
  attributeChangedCallback(): void { this.#sync(); }
  /** Releases listeners when the element leaves the document. */
  disconnectedCallback(): void { if (this.#dialog.open) this.#dialog.close(); }

  /** Reports whether the dialog is open. */
  get open(): boolean { return hasBooleanAttribute(this, "open"); }
  /** Sets whether the dialog is open. */
  set open(value: boolean) { setBooleanAttribute(this, "open", value); }

  /** Opens the dialog as a modal. */
  showModal(): void { this.open = true; }
  /** Closes the dialog with an optional return value. */
  close(returnValue = ""): void {
    this.removeAttribute("open");
    if (this.#dialog.open) this.#dialog.close(returnValue);
  }
  /** Requests cancellation before closing the dialog. */
  requestClose(reason = "api"): void {
    if (hasBooleanAttribute(this, "dismiss-disabled")) return;
    if (hirayaEvent(this, "hiraya-request-close", { reason }, true)) this.close(reason);
  }

  /** Synchronizes the rendered state with current properties. */
  #sync(): void {
    if (!this.isConnected || !this.#dialog) return;
    this.#closeButton.hidden = hasBooleanAttribute(this, "dismiss-disabled");
    this.#closeButton.setAttribute("aria-label", this.getAttribute("close-label") ?? "Close");
    if (this.open && !this.#dialog.open) {
      this.#restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.#dialog.showModal();
    } else if (!this.open && this.#dialog.open) this.#dialog.close();
  }
  /** Restores focus and publishes the dialog result after closing. */
  #closed(): void {
    this.removeAttribute("open");
    this.#restoreFocus?.focus();
    this.#restoreFocus = null;
    hirayaEvent(this, "hiraya-close", { returnValue: this.#dialog.returnValue });
  }
}

/** Implements the Hiraya confirm dialog. */
export class HirayaConfirmDialog extends HTMLElementBase {
  static readonly observedAttributes = ["open", "title", "message", "confirm-label", "cancel-label", "destructive", "busy"];
  readonly #dialog: HirayaDialog;
  readonly #title: HTMLElement;
  readonly #message: HTMLElement;
  readonly #cancel: HTMLElement;
  readonly #confirm: HTMLElement;
  #settled = false;

  /** Creates a hiraya confirm dialog instance. */
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${elementStyles}:host { display: contents; }</style><hiraya-dialog><span slot="title"></span><p></p><hiraya-button slot="actions" data-cancel></hiraya-button><hiraya-button slot="actions" data-confirm></hiraya-button></hiraya-dialog>`;
    this.#dialog = root.querySelector("hiraya-dialog") as HirayaDialog;
    this.#title = root.querySelector("span")!;
    this.#message = root.querySelector("p")!;
    this.#cancel = root.querySelector("[data-cancel]")!;
    this.#confirm = root.querySelector("[data-confirm]")!;
    this.#cancel.addEventListener("click", () => { this.#settled = true; hirayaEvent(this, "hiraya-cancel"); this.open = false; });
    this.#confirm.addEventListener("click", () => {
      if (!hirayaEvent(this, "hiraya-confirm", undefined, true)) return;
      this.#settled = true;
      this.open = false;
    });
    this.#dialog.addEventListener("hiraya-close", () => {
      this.removeAttribute("open");
      if (!this.#settled) hirayaEvent(this, "hiraya-cancel");
      this.#settled = false;
    });
  }
  /** Initializes the element when it joins the document. */
  connectedCallback(): void { this.#sync(); }
  /** Synchronizes state after an observed attribute changes. */
  attributeChangedCallback(): void { this.#sync(); }
  /** Reports whether the confirmation dialog is open. */
  get open(): boolean { return hasBooleanAttribute(this, "open"); }
  /** Sets whether the confirmation dialog is open. */
  set open(value: boolean) {
    if (value && !this.open) this.#settled = false;
    setBooleanAttribute(this, "open", value);
  }
  /** Synchronizes the rendered state with current properties. */
  #sync(): void {
    if (!this.#dialog) return;
    this.#title.textContent = this.getAttribute("title") ?? "Confirm";
    this.#message.textContent = this.getAttribute("message") ?? "";
    this.#cancel.textContent = this.getAttribute("cancel-label") ?? "Cancel";
    this.#confirm.textContent = this.getAttribute("confirm-label") ?? "Confirm";
    this.#confirm.setAttribute("variant", hasBooleanAttribute(this, "destructive") ? "danger" : "primary");
    const busy = hasBooleanAttribute(this, "busy");
    setBooleanAttribute(this.#dialog, "dismiss-disabled", busy);
    setBooleanAttribute(this.#cancel, "disabled", busy);
    setBooleanAttribute(this.#confirm, "loading", busy);
    this.#dialog.open = this.open;
  }
}
