import { elementStyles, hasBooleanAttribute, hirayaEvent, HTMLElementBase, setBooleanAttribute } from "./shared";

let popoverSequence = 0;

type TriggerState = {
  element: HTMLElement;
  ariaControls: string | null;
  ariaExpanded: string | null;
  ariaHasPopup: string | null;
  role: string | null;
  tabIndex: string | null;
  augmented: boolean;
};

export class HirayaPopover extends HTMLElementBase {
  static readonly observedAttributes = ["open", "label"];

  readonly #panel: HTMLElement;
  readonly #triggerSlot: HTMLSlotElement;
  readonly #contentSlot: HTMLSlotElement;
  readonly #panelId = `hiraya-popover-${++popoverSequence}`;
  #triggerState: TriggerState | null = null;
  #restoreFocus: HTMLElement | null = null;
  #animationFrame = 0;
  #closeReason = "api";

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${elementStyles}
      :host { display: inline-block; }
      .panel { position: fixed; inset: auto; z-index: 1000; min-inline-size: min(12rem, calc(100vw - 1rem)); max-inline-size: min(24rem, calc(100vw - 1rem)); max-block-size: calc(100dvh - 1rem); overflow: auto; margin: 0; padding: var(--hiraya-space-2, .5rem); border: 1px solid var(--hiraya-border, #526a60); border-radius: var(--hiraya-radius-panel, .75rem); color: var(--hiraya-text, #f5eedc); background: var(--hiraya-surface-elevated, #20352d); box-shadow: var(--hiraya-shadow-panel, 0 1rem 3rem rgb(0 0 0 / .3)); }
      .panel[hidden] { display: none; }
      .panel:popover-open { display: block; }
      @media (prefers-reduced-transparency: reduce) { .panel { background: var(--hiraya-surface-elevated, #20352d); } }
    </style><slot name="trigger"></slot><div class="panel" id="${this.#panelId}" part="content" role="dialog" popover="manual" hidden><slot name="content"></slot></div>`;
    this.#panel = root.querySelector<HTMLElement>(".panel")!;
    this.#triggerSlot = root.querySelector<HTMLSlotElement>('slot[name="trigger"]')!;
    this.#contentSlot = root.querySelector<HTMLSlotElement>('slot[name="content"]')!;
    this.#triggerSlot.addEventListener("slotchange", () => this.#syncTrigger());
    root.addEventListener("click", (event) => this.#onClick(event));
    root.addEventListener("keydown", (event) => this.#onKeyDown(event));
  }

  connectedCallback(): void {
    this.#syncTrigger();
    this.#sync();
  }

  attributeChangedCallback(): void { this.#sync(); }

  disconnectedCallback(): void {
    this.#removeDocumentListeners();
    this.#cancelPosition();
    this.#hidePanel();
    this.#restoreTrigger();
    this.#restoreFocus = null;
  }

  get open(): boolean { return hasBooleanAttribute(this, "open"); }
  set open(value: boolean) { setBooleanAttribute(this, "open", value); }

  show(): void { this.open = true; }
  hide(reason = "api"): void {
    if (!this.open) return;
    this.#closeReason = reason;
    this.open = false;
  }
  toggle(force?: boolean): void { this.open = force ?? !this.open; }

  #sync(): void {
    if (!this.isConnected) return;
    this.#panel.setAttribute("aria-label", this.getAttribute("label") ?? "Popover");
    this.#syncTrigger();
    if (this.open) this.#showPanel();
    else this.#closePanel();
  }

  #showPanel(): void {
    if (!this.#panel.hidden) {
      this.#schedulePosition();
      return;
    }
    const active = this.ownerDocument.activeElement;
    this.#restoreFocus = active instanceof HTMLElement ? active : this.#triggerState?.element ?? null;
    this.#panel.hidden = false;
    const showPopover = (this.#panel as HTMLElement & { showPopover?: () => void }).showPopover;
    if (typeof showPopover === "function") {
      try { showPopover.call(this.#panel); } catch { /* The fixed-position fallback remains visible. */ }
    }
    this.#setTriggerExpanded(true);
    this.#addDocumentListeners();
    this.#schedulePosition();
    queueMicrotask(() => this.#focusContent());
    hirayaEvent(this, "hiraya-open-change", { open: true, reason: "api" });
  }

  #closePanel(): void {
    if (this.#panel.hidden) return;
    this.#removeDocumentListeners();
    this.#cancelPosition();
    this.#hidePanel();
    this.#setTriggerExpanded(false);
    const restore = this.#restoreFocus;
    this.#restoreFocus = null;
    if (restore?.isConnected) restore.focus();
    hirayaEvent(this, "hiraya-open-change", { open: false, reason: this.#closeReason });
    this.#closeReason = "api";
  }

  #hidePanel(): void {
    const hidePopover = (this.#panel as HTMLElement & { hidePopover?: () => void }).hidePopover;
    if (typeof hidePopover === "function" && this.#panel.matches(":popover-open")) {
      try { hidePopover.call(this.#panel); } catch { /* It may already have left the top layer. */ }
    }
    this.#panel.hidden = true;
  }

  #onClick(event: Event): void {
    const trigger = this.#triggerState?.element;
    if (trigger && event.composedPath().includes(trigger)) this.toggle();
  }

  #onKeyDown(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    const trigger = this.#triggerState?.element;
    if (!trigger || !event.composedPath().includes(trigger)) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.toggle();
    } else if (event.key === "ArrowDown" && !this.open) {
      event.preventDefault();
      this.show();
    }
  }

  readonly #onDocumentPointerDown = (event: Event): void => {
    if (!event.composedPath().includes(this)) this.hide("outside");
  };

  readonly #onDocumentKeyDown = (event: Event): void => {
    if (event instanceof KeyboardEvent && event.key === "Escape") {
      event.preventDefault();
      this.hide("escape");
    }
  };

  readonly #onViewportChange = (): void => this.#schedulePosition();

  #addDocumentListeners(): void {
    this.ownerDocument.addEventListener("pointerdown", this.#onDocumentPointerDown, true);
    this.ownerDocument.addEventListener("keydown", this.#onDocumentKeyDown, true);
    this.ownerDocument.addEventListener("scroll", this.#onViewportChange, true);
    const view = this.ownerDocument.defaultView;
    view?.addEventListener("resize", this.#onViewportChange);
    view?.visualViewport?.addEventListener("resize", this.#onViewportChange);
    view?.visualViewport?.addEventListener("scroll", this.#onViewportChange);
  }

  #removeDocumentListeners(): void {
    this.ownerDocument.removeEventListener("pointerdown", this.#onDocumentPointerDown, true);
    this.ownerDocument.removeEventListener("keydown", this.#onDocumentKeyDown, true);
    this.ownerDocument.removeEventListener("scroll", this.#onViewportChange, true);
    const view = this.ownerDocument.defaultView;
    view?.removeEventListener("resize", this.#onViewportChange);
    view?.visualViewport?.removeEventListener("resize", this.#onViewportChange);
    view?.visualViewport?.removeEventListener("scroll", this.#onViewportChange);
  }

  #schedulePosition(): void {
    this.#cancelPosition();
    const view = this.ownerDocument.defaultView;
    if (!view) return;
    this.#animationFrame = view.requestAnimationFrame(() => {
      this.#animationFrame = 0;
      this.#position();
    });
  }

  #cancelPosition(): void {
    if (!this.#animationFrame) return;
    this.ownerDocument.defaultView?.cancelAnimationFrame(this.#animationFrame);
    this.#animationFrame = 0;
  }

  #position(): void {
    const trigger = this.#triggerState?.element;
    const view = this.ownerDocument.defaultView;
    if (!trigger || !view || this.#panel.hidden) return;
    const viewport = view.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? view.innerWidth;
    const viewportHeight = viewport?.height ?? view.innerHeight;
    const margin = 8;
    const gap = 6;
    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = this.#panel.getBoundingClientRect();
    const spaceBelow = viewportTop + viewportHeight - triggerRect.bottom;
    const top = spaceBelow >= panelRect.height + gap || spaceBelow >= triggerRect.top - viewportTop
      ? triggerRect.bottom + gap
      : triggerRect.top - panelRect.height - gap;
    const left = Math.min(
      Math.max(triggerRect.left, viewportLeft + margin),
      viewportLeft + viewportWidth - panelRect.width - margin,
    );
    this.#panel.style.left = `${Math.max(viewportLeft + margin, left)}px`;
    this.#panel.style.top = `${Math.min(Math.max(top, viewportTop + margin), viewportTop + viewportHeight - panelRect.height - margin)}px`;
    this.#panel.style.maxHeight = `${Math.max(80, viewportHeight - margin * 2)}px`;
  }

  #focusContent(): void {
    if (!this.open) return;
    const content = this.#contentSlot.assignedElements({ flatten: true })[0] as (HTMLElement & { focusFirst?: () => void }) | undefined;
    if (typeof content?.focusFirst === "function") content.focusFirst();
    else content?.focus({ preventScroll: true });
  }

  #syncTrigger(): void {
    const trigger = this.#triggerSlot.assignedElements({ flatten: true }).find((element): element is HTMLElement => element instanceof HTMLElement) ?? null;
    if (trigger === this.#triggerState?.element) {
      this.#setTriggerExpanded(this.open);
      return;
    }
    this.#restoreTrigger();
    if (!trigger) return;
    const interactive = trigger.matches('button, hiraya-button, a[href], input, select, textarea, summary, [tabindex], [role="button"]');
    this.#triggerState = {
      element: trigger,
      ariaControls: trigger.getAttribute("aria-controls"),
      ariaExpanded: trigger.getAttribute("aria-expanded"),
      ariaHasPopup: trigger.getAttribute("aria-haspopup"),
      role: trigger.getAttribute("role"),
      tabIndex: trigger.getAttribute("tabindex"),
      augmented: !interactive,
    };
    trigger.setAttribute("aria-controls", this.#panelId);
    trigger.setAttribute("aria-haspopup", "dialog");
    if (!interactive) {
      trigger.setAttribute("role", "button");
      trigger.tabIndex = 0;
    }
    this.#setTriggerExpanded(this.open);
  }

  #setTriggerExpanded(expanded: boolean): void {
    this.#triggerState?.element.setAttribute("aria-expanded", String(expanded));
  }

  #restoreTrigger(): void {
    const state = this.#triggerState;
    if (!state) return;
    this.#restoreAttribute(state.element, "aria-controls", state.ariaControls);
    this.#restoreAttribute(state.element, "aria-expanded", state.ariaExpanded);
    this.#restoreAttribute(state.element, "aria-haspopup", state.ariaHasPopup);
    if (state.augmented) {
      this.#restoreAttribute(state.element, "role", state.role);
      this.#restoreAttribute(state.element, "tabindex", state.tabIndex);
    }
    this.#triggerState = null;
  }

  #restoreAttribute(element: HTMLElement, name: string, value: string | null): void {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
}
