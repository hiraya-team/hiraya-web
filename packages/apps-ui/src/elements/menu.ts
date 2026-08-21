import { elementStyles, focusableElements, hasBooleanAttribute, hirayaEvent, HTMLElementBase, setBooleanAttribute } from "./shared";

type MenuEntry = HTMLElement & {
  disabled: boolean;
  menuTabIndex: number;
  activate?: () => void;
  open?: boolean;
  focus(options?: FocusOptions): void;
};

/** Reports whether an element is a supported menu entry. */
function isMenuEntry(element: Element): element is MenuEntry {
  return element instanceof HTMLElement && (element.tagName === "HIRAYA-MENU-ITEM" || element.tagName === "HIRAYA-SUBMENU");
}

/** Returns the menu entries assigned to a slot. */
function assignedEntries(slot: HTMLSlotElement): MenuEntry[] {
  return slot.assignedElements({ flatten: true }).filter(isMenuEntry);
}

/** Returns enabled, visible menu entries assigned to a slot. */
function enabledEntries(slot: HTMLSlotElement): MenuEntry[] {
  return assignedEntries(slot).filter((entry) => !entry.disabled && !entry.hidden);
}

/** Moves focus. */
function moveFocus(slot: HTMLSlotElement, current: Element | null, direction: 1 | -1 | "first" | "last"): void {
  const entries = enabledEntries(slot);
  if (!entries.length) return;
  let index: number;
  if (direction === "first") index = 0;
  else if (direction === "last") index = entries.length - 1;
  else {
    const currentIndex = entries.findIndex((entry) => entry === current || entry.contains(current));
    index = currentIndex < 0 ? (direction === 1 ? 0 : entries.length - 1) : (currentIndex + direction + entries.length) % entries.length;
  }
  entries.forEach((entry) => { entry.menuTabIndex = entry === entries[index] ? 0 : -1; });
  entries[index]?.focus();
}

/** Synchronizes roving tab index. */
function syncRovingTabIndex(slot: HTMLSlotElement): void {
  const entries = enabledEntries(slot);
  const selected = entries.find((entry) => entry.menuTabIndex === 0) ?? entries[0];
  assignedEntries(slot).forEach((entry) => { entry.menuTabIndex = entry === selected ? 0 : -1; });
}

/** Finds the menu entry that owns an event. */
function owningEntry(event: Event): MenuEntry | null {
  return event.composedPath().find((target): target is MenuEntry => target instanceof Element && isMenuEntry(target)) ?? null;
}

/** Implements the Hiraya menu item. */
export class HirayaMenuItem extends HTMLElementBase {
  static readonly observedAttributes = ["disabled", "value"];
  readonly #item: HTMLElement;

  /** Creates a hiraya menu item instance. */
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${elementStyles}
      :host { display: block; }
      .item { display: flex; min-block-size: var(--hiraya-control-height, 2.25rem); align-items: center; gap: var(--hiraya-space-2, .5rem); padding: .45rem .65rem; border-radius: var(--hiraya-radius-control, .45rem); cursor: default; user-select: none; }
      .item:hover:not([aria-disabled="true"]), .item:focus-visible { background: var(--hiraya-surface-hover, #294238); }
      .item[aria-disabled="true"] { opacity: .5; }
      .label { min-inline-size: 0; flex: 1; }
    </style><div class="item" part="item" role="menuitem" tabindex="-1"><slot name="icon"></slot><span class="label" part="label"><slot></slot></span><slot name="meta"></slot></div>`;
    this.#item = root.querySelector<HTMLElement>(".item")!;
    this.#item.addEventListener("click", () => this.activate());
  }

  /** Initializes the element when it joins the document. */
  connectedCallback(): void { this.#sync(); }
  /** Synchronizes state after an observed attribute changes. */
  attributeChangedCallback(): void { this.#sync(); }

  /** Returns the menu item's value. */
  get value(): string { return this.getAttribute("value") ?? ""; }
  /** Sets the menu item's value. */
  set value(value: string) { this.setAttribute("value", value); }
  /** Reports whether the menu item is disabled. */
  get disabled(): boolean { return hasBooleanAttribute(this, "disabled"); }
  /** Sets whether the menu item is disabled. */
  set disabled(value: boolean) { setBooleanAttribute(this, "disabled", value); }
  /** Returns the menu item's roving tab index. */
  get menuTabIndex(): number { return this.#item.tabIndex; }
  /** Sets the menu item's roving tab index. */
  set menuTabIndex(value: number) { this.#item.tabIndex = value; }

  /** Moves focus to this element. */
  focus(options?: FocusOptions): void { this.#item.focus(options); }

  /** Activates this element. */
  activate(): void {
    if (!this.disabled) hirayaEvent(this, "hiraya-select", { value: this.value });
  }

  /** Synchronizes the rendered state with current properties. */
  #sync(): void {
    if (!this.#item) return;
    this.#item.setAttribute("aria-disabled", String(this.disabled));
    if (this.disabled) this.#item.tabIndex = -1;
  }
}

/** Implements the Hiraya menu. */
export class HirayaMenu extends HTMLElementBase {
  readonly #slot: HTMLSlotElement;

  /** Creates a hiraya menu instance. */
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${elementStyles}
      :host { display: block; }
      .surface { display: block; min-inline-size: 11rem; padding: var(--hiraya-space-1, .25rem); border: 1px solid var(--hiraya-border, #526a60); border-radius: var(--hiraya-radius-panel, .75rem); color: var(--hiraya-text, #f5eedc); background: var(--hiraya-surface-elevated, #20352d); box-shadow: var(--hiraya-shadow-panel, 0 1rem 3rem rgb(0 0 0 / .3)); }
    </style><div class="surface" part="menu" role="menu"><slot></slot></div>`;
    this.#slot = root.querySelector<HTMLSlotElement>("slot")!;
    this.#slot.addEventListener("slotchange", () => syncRovingTabIndex(this.#slot));
    this.addEventListener("focusin", (event) => this.#onFocusIn(event));
    this.addEventListener("keydown", (event) => this.#onKeyDown(event));
  }

  /** Initializes the element when it joins the document. */
  connectedCallback(): void { syncRovingTabIndex(this.#slot); }

  /** Moves focus to the first enabled menu entry. */
  focusFirst(): void { moveFocus(this.#slot, null, "first"); }
  /** Moves focus to the last enabled menu entry. */
  focusLast(): void { moveFocus(this.#slot, null, "last"); }

  /** Updates roving focus when focus enters the menu. */
  #onFocusIn(event: FocusEvent): void {
    const entry = owningEntry(event);
    if (!entry || !assignedEntries(this.#slot).includes(entry)) return;
    assignedEntries(this.#slot).forEach((candidate) => { candidate.menuTabIndex = candidate === entry ? 0 : -1; });
  }

  /** Handles menu keyboard navigation and activation. */
  #onKeyDown(event: KeyboardEvent): void {
    const nearestMenu = event.composedPath().find((target) => target instanceof HirayaMenu);
    if (nearestMenu !== this || event.defaultPrevented) return;
    const entry = owningEntry(event);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(this.#slot, entry, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      moveFocus(this.#slot, entry, event.key === "Home" ? "first" : "last");
    } else if ((event.key === "Enter" || event.key === " ") && entry) {
      event.preventDefault();
      entry.activate?.();
    } else if (event.key === "Escape") {
      event.preventDefault();
      hirayaEvent(this, "hiraya-menu-dismiss", { reason: "escape" });
    }
  }
}

/** Implements the Hiraya submenu. */
export class HirayaSubmenu extends HTMLElementBase {
  static readonly observedAttributes = ["open", "disabled"];
  readonly #trigger: HTMLElement;
  readonly #menuSlot: HTMLSlotElement;

  /** Creates a hiraya submenu instance. */
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${elementStyles}
      :host { position: relative; display: block; }
      .trigger { display: flex; min-block-size: var(--hiraya-control-height, 2.25rem); align-items: center; gap: var(--hiraya-space-2, .5rem); padding: .45rem .65rem; border-radius: var(--hiraya-radius-control, .45rem); cursor: default; user-select: none; }
      .trigger:hover:not([aria-disabled="true"]), .trigger:focus-visible { background: var(--hiraya-surface-hover, #294238); }
      .trigger[aria-disabled="true"] { opacity: .5; }
      .label { min-inline-size: 0; flex: 1; }
      .arrow { margin-inline-start: auto; }
      .submenu { position: absolute; z-index: 1; inset-block-start: -.25rem; inset-inline-start: calc(100% + .25rem); }
      @media (max-width: 40rem) { .submenu { position: static; margin-inline-start: var(--hiraya-space-3, .75rem); } }
    </style><div class="trigger" part="trigger" role="menuitem" aria-haspopup="menu" aria-expanded="false" tabindex="-1"><span class="label"><slot name="trigger"></slot></span><span class="arrow" aria-hidden="true">›</span></div><div class="submenu" part="submenu" hidden><slot name="menu"></slot></div>`;
    this.#trigger = root.querySelector<HTMLElement>(".trigger")!;
    this.#menuSlot = root.querySelector<HTMLSlotElement>('slot[name="menu"]')!;
    this.#trigger.addEventListener("click", () => { if (!this.disabled) this.open = !this.open; });
    this.addEventListener("keydown", (event) => this.#onKeyDown(event));
    this.addEventListener("hiraya-select", () => { this.open = false; });
  }

  /** Initializes the element when it joins the document. */
  connectedCallback(): void { this.#sync(); }
  /** Synchronizes state after an observed attribute changes. */
  attributeChangedCallback(): void { this.#sync(); }

  /** Reports whether the submenu is open. */
  get open(): boolean { return hasBooleanAttribute(this, "open"); }
  /** Sets whether the submenu is open. */
  set open(value: boolean) { setBooleanAttribute(this, "open", value); }
  /** Reports whether the submenu is disabled. */
  get disabled(): boolean { return hasBooleanAttribute(this, "disabled"); }
  /** Sets whether the submenu is disabled. */
  set disabled(value: boolean) { setBooleanAttribute(this, "disabled", value); }
  /** Returns the submenu's roving tab index. */
  get menuTabIndex(): number { return this.#trigger.tabIndex; }
  /** Sets the submenu's roving tab index. */
  set menuTabIndex(value: number) { this.#trigger.tabIndex = value; }

  /** Moves focus to this element. */
  focus(options?: FocusOptions): void { this.#trigger.focus(options); }
  /** Activates this element. */
  activate(): void { if (!this.disabled) this.open = true; }

  /** Handles keyboard navigation into and out of the submenu. */
  #onKeyDown(event: KeyboardEvent): void {
    const onTrigger = event.composedPath().includes(this.#trigger);
    if (onTrigger && (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ")) {
      if (this.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      this.open = true;
      this.#nestedMenu()?.focusFirst();
    } else if (!onTrigger && this.open && (event.key === "ArrowLeft" || event.key === "Escape")) {
      event.preventDefault();
      event.stopPropagation();
      this.open = false;
      this.focus();
    } else if (onTrigger && event.key === "ArrowLeft") {
      hirayaEvent(this, "hiraya-menu-dismiss", { reason: "submenu-left" });
    }
  }

  /** Returns the menu assigned to this submenu. */
  #nestedMenu(): HirayaMenu | null {
    return this.#menuSlot.assignedElements({ flatten: true }).find((element): element is HirayaMenu => element instanceof HirayaMenu) ?? null;
  }

  /** Synchronizes the rendered state with current properties. */
  #sync(): void {
    if (!this.#trigger) return;
    this.#trigger.setAttribute("aria-expanded", String(this.open));
    this.#trigger.setAttribute("aria-disabled", String(this.disabled));
    if (this.disabled) this.#trigger.tabIndex = -1;
    const panel = this.shadowRoot?.querySelector<HTMLElement>(".submenu");
    if (panel) panel.hidden = !this.open;
  }
}

/** Implements the Hiraya action sheet. */
export class HirayaActionSheet extends HTMLElementBase {
  static readonly observedAttributes = ["open", "label"];
  readonly #dialog: HTMLDialogElement;
  readonly #sheet: HTMLElement;
  readonly #slot: HTMLSlotElement;
  #restoreFocus: HTMLElement | null = null;
  #usingFallback = false;
  #closing = false;

  /** Creates a hiraya action sheet instance. */
  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${elementStyles}
      :host { display: contents; }
      dialog { inline-size: min(30rem, 100%); max-inline-size: none; max-block-size: calc(100dvh - 1rem); margin: auto auto 0; padding: 0; overflow: visible; border: 0; color: var(--hiraya-text, #f5eedc); background: transparent; }
      dialog::backdrop { background: rgb(0 0 0 / .55); }
      dialog.fallback { position: fixed; z-index: 1100; inset: 0; display: grid; inline-size: 100%; block-size: 100%; max-block-size: none; align-items: end; background: rgb(0 0 0 / .55); }
      dialog[hidden] { display: none; }
      .sheet { max-block-size: calc(100dvh - 1rem); overflow: auto; padding: var(--hiraya-space-2, .5rem); padding-block-end: max(var(--hiraya-space-2, .5rem), env(safe-area-inset-bottom)); border: 1px solid var(--hiraya-border, #526a60); border-block-end: 0; border-radius: var(--hiraya-radius-panel, .75rem) var(--hiraya-radius-panel, .75rem) 0 0; background: var(--hiraya-surface-elevated, #20352d); box-shadow: var(--hiraya-shadow-panel, 0 1rem 3rem rgb(0 0 0 / .3)); }
      .handle { inline-size: 2.5rem; block-size: .25rem; margin: .25rem auto .6rem; border-radius: 999px; background: var(--hiraya-border, #526a60); }
      .menu { display: block; }
      ::slotted(hiraya-menu-item), ::slotted(hiraya-submenu) { min-block-size: var(--hiraya-touch-target, 2.75rem); }
    </style><dialog part="dialog" hidden><section class="sheet" part="sheet"><div class="handle" aria-hidden="true"></div><div class="menu" part="menu" role="menu"><slot></slot></div></section></dialog>`;
    this.#dialog = root.querySelector<HTMLDialogElement>("dialog")!;
    this.#sheet = root.querySelector<HTMLElement>(".sheet")!;
    this.#slot = root.querySelector<HTMLSlotElement>("slot")!;
    this.#slot.addEventListener("slotchange", () => syncRovingTabIndex(this.#slot));
    this.#dialog.addEventListener("cancel", (event) => { event.preventDefault(); this.requestClose("escape"); });
    this.#dialog.addEventListener("click", (event) => { if (event.target === this.#dialog) this.requestClose("backdrop"); });
    this.addEventListener("keydown", (event) => this.#onKeyDown(event));
    this.addEventListener("focusin", (event) => this.#onFocusIn(event));
    this.addEventListener("hiraya-select", () => this.requestClose("select"));
  }

  /** Initializes the element when it joins the document. */
  connectedCallback(): void { this.#sync(); }
  /** Synchronizes state after an observed attribute changes. */
  attributeChangedCallback(): void { this.#sync(); }
  /** Releases listeners when the element leaves the document. */
  disconnectedCallback(): void {
    this.#removeFallbackListeners();
    if (this.#dialog.open) this.#dialog.close();
    this.#dialog.hidden = true;
    this.#restoreFocus = null;
  }

  /** Reports whether the action sheet is open. */
  get open(): boolean { return hasBooleanAttribute(this, "open"); }
  /** Sets whether the action sheet is open. */
  set open(value: boolean) { setBooleanAttribute(this, "open", value); }

  /** Opens the action sheet as a modal. */
  showModal(): void { this.open = true; }
  /** Closes the action sheet and restores focus. */
  close(reason = "api"): void {
    if (!this.open && !this.#dialog.open && this.#dialog.hidden) return;
    this.#closing = true;
    this.removeAttribute("open");
    if (this.#dialog.open) this.#dialog.close(reason);
    this.#dialog.hidden = true;
    this.#removeFallbackListeners();
    const restore = this.#restoreFocus;
    this.#restoreFocus = null;
    if (restore?.isConnected) restore.focus();
    this.#closing = false;
    hirayaEvent(this, "hiraya-close", { reason });
  }
  /** Requests cancellation before closing the action sheet. */
  requestClose(reason = "api"): void {
    if (hirayaEvent(this, "hiraya-request-close", { reason }, true)) this.close(reason);
  }

  /** Synchronizes the rendered state with current properties. */
  #sync(): void {
    if (!this.isConnected || this.#closing) return;
    this.#dialog.setAttribute("aria-label", this.getAttribute("label") ?? "Actions");
    syncRovingTabIndex(this.#slot);
    if (this.open && !this.#dialog.open && this.#dialog.hidden) this.#show();
    else if (!this.open && (this.#dialog.open || !this.#dialog.hidden)) this.close("api");
  }

  /** Shows the element. */
  #show(): void {
    const active = this.ownerDocument.activeElement;
    this.#restoreFocus = active instanceof HTMLElement ? active : null;
    this.#dialog.hidden = false;
    this.#usingFallback = typeof this.#dialog.showModal !== "function";
    if (this.#usingFallback) {
      this.#dialog.classList.add("fallback");
      this.#dialog.setAttribute("open", "");
      this.#dialog.setAttribute("aria-modal", "true");
      this.ownerDocument.addEventListener("keydown", this.#onFallbackKeyDown, true);
    } else {
      this.#dialog.classList.remove("fallback");
      this.#dialog.showModal();
    }
    moveFocus(this.#slot, null, "first");
  }

  /** Updates roving focus when focus enters the action sheet. */
  #onFocusIn(event: FocusEvent): void {
    const entry = owningEntry(event);
    if (!entry || !assignedEntries(this.#slot).includes(entry)) return;
    assignedEntries(this.#slot).forEach((candidate) => { candidate.menuTabIndex = candidate === entry ? 0 : -1; });
  }

  /** Handles action-sheet keyboard navigation and dismissal. */
  #onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const entry = owningEntry(event);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(this.#slot, entry, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      moveFocus(this.#slot, entry, event.key === "Home" ? "first" : "last");
    } else if ((event.key === "Enter" || event.key === " ") && entry) {
      event.preventDefault();
      entry.activate?.();
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.requestClose("escape");
    } else if (event.key === "Tab" && this.#usingFallback) {
      const focusable = [...enabledEntries(this.#slot), ...focusableElements(this.#sheet)];
      if (!focusable.length) return;
      event.preventDefault();
      const current = focusable.findIndex((element) => element === entry || element === this.ownerDocument.activeElement);
      focusable[(current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length]?.focus();
    }
  }

  readonly #onFallbackKeyDown = (event: Event): void => {
    if (event instanceof KeyboardEvent && event.key === "Escape") {
      event.preventDefault();
      this.requestClose("escape");
    }
  };

  /** Removes fallback listeners. */
  #removeFallbackListeners(): void {
    this.ownerDocument.removeEventListener("keydown", this.#onFallbackKeyDown, true);
    this.#dialog.classList.remove("fallback");
    this.#dialog.removeAttribute("aria-modal");
    if (this.#usingFallback) this.#dialog.removeAttribute("open");
    this.#usingFallback = false;
  }
}
