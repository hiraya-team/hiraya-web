import { elementStyles, HTMLElementBase } from "./shared";

export class HirayaToolbar extends HTMLElementBase {
  static readonly observedAttributes = ["label", "wrap"];
  readonly #toolbar: HTMLElement;
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${elementStyles}
      :host { display: block; min-inline-size: 0; }
      [role="toolbar"] { display: flex; min-inline-size: 0; align-items: center; gap: var(--hiraya-space-2, .5rem); padding: .55rem .7rem; border-block-end: 1px solid var(--hiraya-border, #526a60); background: var(--hiraya-surface, #172722); }
      :host([wrap]) [role="toolbar"] { flex-wrap: wrap; }
      .actions { display: flex; min-inline-size: 0; align-items: center; gap: var(--hiraya-space-2, .5rem); margin-inline-start: auto; }
      @media (max-width: 32.5rem) { [role="toolbar"] { flex-wrap: wrap; } }
    </style><header part="toolbar" role="toolbar"><slot name="leading"></slot><slot></slot><span class="actions" part="actions"><slot name="actions"></slot></span></header>`;
    this.#toolbar = root.querySelector("header")!;
  }
  connectedCallback(): void { this.#sync(); }
  attributeChangedCallback(): void { this.#sync(); }
  #sync(): void { this.#toolbar?.setAttribute("aria-label", this.getAttribute("label") ?? "App toolbar"); }
}

export class HirayaPanel extends HTMLElementBase {
  readonly #header: HTMLElement;
  readonly #footer: HTMLElement;
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${elementStyles}
      :host { display: block; overflow: hidden; border: var(--hiraya-border-width, 1px) solid var(--hiraya-border, #526a60); border-radius: var(--hiraya-radius-panel, .75rem); background: var(--hiraya-surface, #172722); }
      header { padding: var(--hiraya-space-3, .75rem) var(--hiraya-space-4, 1rem); border-block-end: 1px solid var(--hiraya-border, #526a60); }
      .body { padding: var(--hiraya-space-4, 1rem); }
      footer { padding: var(--hiraya-space-3, .75rem) var(--hiraya-space-4, 1rem); border-block-start: 1px solid var(--hiraya-border, #526a60); }
    </style><section part="panel"><header part="header"><slot name="header"></slot></header><div class="body" part="body"><slot></slot></div><footer part="footer"><slot name="footer"></slot></footer></section>`;
    this.#header = root.querySelector("header")!;
    this.#footer = root.querySelector("footer")!;
    root.querySelector<HTMLSlotElement>('slot[name="header"]')!.addEventListener("slotchange", () => this.#syncRegions());
    root.querySelector<HTMLSlotElement>('slot[name="footer"]')!.addEventListener("slotchange", () => this.#syncRegions());
  }
  connectedCallback(): void { this.#syncRegions(); }
  #syncRegions(): void {
    this.#header.hidden = !this.#hasAssignedContent("header");
    this.#footer.hidden = !this.#hasAssignedContent("footer");
  }
  #hasAssignedContent(name: string): boolean {
    const slot = this.shadowRoot?.querySelector<HTMLSlotElement>(`slot[name="${name}"]`);
    return slot?.assignedNodes({ flatten: true }).some((node) => node.nodeType !== Node.TEXT_NODE || Boolean(node.textContent?.trim())) ?? false;
  }
}

export class HirayaStatusBar extends HTMLElementBase {
  static readonly observedAttributes = ["tone", "live"];
  readonly #status: HTMLElement;
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${elementStyles}
      :host { display: block; }
      div { min-block-size: 2rem; padding: .35rem .7rem; overflow: hidden; border-block-start: 1px solid var(--hiraya-border, #526a60); color: var(--hiraya-text-muted, #aabbb4); background: var(--hiraya-surface, #172722); font-size: .8rem; text-overflow: ellipsis; white-space: nowrap; }
      .danger { color: var(--hiraya-danger, #ff8175); }
      :host(.error) div { color: var(--hiraya-danger, #ff8175); }
      .accent { color: var(--hiraya-accent, #e2aa52); }
    </style><div part="status"><slot></slot></div>`;
    this.#status = root.querySelector("div")!;
  }
  connectedCallback(): void { this.#sync(); }
  attributeChangedCallback(): void { this.#sync(); }
  #sync(): void {
    if (!this.#status) return;
    this.#status.className = this.getAttribute("tone") ?? "neutral";
    const live = this.getAttribute("live");
    if (live) { this.#status.setAttribute("role", "status"); this.#status.setAttribute("aria-live", live === "assertive" ? "assertive" : "polite"); }
    else { this.#status.removeAttribute("role"); this.#status.removeAttribute("aria-live"); }
  }
}

export class HirayaEmptyState extends HTMLElementBase {
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${elementStyles}
      :host { display: grid; min-block-size: 14rem; padding: 2rem; place-content: center; color: var(--hiraya-text-muted, #aabbb4); text-align: center; }
      .content { display: grid; justify-items: center; gap: var(--hiraya-space-2, .5rem); max-inline-size: 32rem; }
      .title { color: var(--hiraya-text, #f5eedc); font-size: 1.1rem; font-weight: var(--hiraya-font-weight-control, 650); }
      .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--hiraya-space-2, .5rem); margin-block-start: var(--hiraya-space-2, .5rem); }
    </style><section class="content" part="content"><slot name="icon"></slot><div class="title" part="title"><slot name="title"></slot></div><div part="description"><slot></slot></div><div class="actions" part="actions"><slot name="actions"></slot></div></section>`;
  }
}
