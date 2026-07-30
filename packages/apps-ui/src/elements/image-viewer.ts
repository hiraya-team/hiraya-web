import { defineElement, elementStyles, hirayaEvent, HTMLElementBase } from "./shared";

export type HirayaImageZoom = "fit" | number;

export function clampImageZoom(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function calculateImageFitZoom(
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number,
  minimum: number,
  maximum: number,
): number {
  if (viewportWidth <= 0 || viewportHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) return minimum;
  return clampImageZoom(Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight), minimum, maximum);
}

type Point = { x: number; y: number };

export class HirayaImageViewer extends HTMLElementBase {
  static readonly observedAttributes = ["src", "alt", "zoom", "min-zoom", "max-zoom", "rotation"];

  readonly #viewport: HTMLElement;
  readonly #image: HTMLImageElement;
  readonly #pointers = new Map<number, Point>();
  #listeners: AbortController | null = null;
  #observer: ResizeObserver | null = null;
  #frame: number | null = null;
  #scale = 1;
  #panX = 0;
  #panY = 0;
  #gestureScale = 1;
  #gestureDistance = 0;
  #gestureMidpoint: Point = { x: 0, y: 0 };
  #gesturePan: Point = { x: 0, y: 0 };
  #lastPointer: Point | null = null;
  #renderedSrc: string | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${elementStyles}
      :host { display: block; min-block-size: 12rem; min-inline-size: 0; overflow: hidden; background: var(--hiraya-background, #13231f); }
      .viewport { position: relative; inline-size: 100%; block-size: 100%; min-block-size: inherit; overflow: hidden; outline-offset: -3px; cursor: grab; touch-action: none; user-select: none; }
      .viewport[data-panning] { cursor: grabbing; }
      img { position: absolute; inset-block-start: 50%; inset-inline-start: 50%; display: block; max-inline-size: none; pointer-events: none; transform-origin: center; will-change: transform; -webkit-user-drag: none; }
      @media (prefers-reduced-motion: no-preference) { img { transition: opacity var(--hiraya-motion-normal, 180ms); } }
    </style><div class="viewport" part="viewport" tabindex="0" role="region" aria-label="Image viewer"><img part="image" draggable="false"></div>`;
    this.#viewport = root.querySelector<HTMLElement>(".viewport")!;
    this.#image = root.querySelector<HTMLImageElement>("img")!;
  }

  connectedCallback(): void {
    this.#connectListeners();
    this.#syncAttributes();
    if (typeof ResizeObserver !== "undefined") {
      this.#observer = new ResizeObserver(() => {
        if (this.zoom === "fit") this.#applyFit(false);
        else this.#constrainPan();
      });
      this.#observer.observe(this.#viewport);
    }
  }

  disconnectedCallback(): void {
    this.#listeners?.abort();
    this.#listeners = null;
    this.#observer?.disconnect();
    this.#observer = null;
    this.#pointers.clear();
    this.#lastPointer = null;
    if (this.#frame !== null && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(this.#frame);
    this.#frame = null;
  }

  attributeChangedCallback(): void {
    if (this.#image) this.#syncAttributes();
  }

  get src(): string { return this.getAttribute("src") ?? ""; }
  set src(value: string) { if (value) this.setAttribute("src", value); else this.removeAttribute("src"); }
  get alt(): string { return this.getAttribute("alt") ?? ""; }
  set alt(value: string) { this.setAttribute("alt", value); }
  get zoom(): HirayaImageZoom {
    const value = this.getAttribute("zoom");
    if (!value || value === "fit") return "fit";
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : "fit";
  }
  set zoom(value: HirayaImageZoom) { this.setAttribute("zoom", value === "fit" ? value : String(value)); }
  get minZoom(): number { return this.#positiveAttribute("min-zoom", 0.1); }
  set minZoom(value: number) { this.setAttribute("min-zoom", String(value)); }
  get maxZoom(): number { return Math.max(this.minZoom, this.#positiveAttribute("max-zoom", 8)); }
  set maxZoom(value: number) { this.setAttribute("max-zoom", String(value)); }
  get rotation(): number {
    const value = Number(this.getAttribute("rotation"));
    return Number.isFinite(value) ? ((value % 360) + 360) % 360 : 0;
  }
  set rotation(value: number) { this.setAttribute("rotation", String(value)); }

  fit(): void {
    this.#applyFit(true);
    if (this.getAttribute("zoom") !== "fit") this.setAttribute("zoom", "fit");
  }

  reset(): void {
    if (!this.#image.naturalWidth) return;
    this.#panX = 0;
    this.#panY = 0;
    this.#setNumericZoom(1, true);
  }

  zoomBy(delta: number): void {
    if (!this.#image.naturalWidth || !Number.isFinite(delta) || delta === 0) return;
    this.#setNumericZoom(this.#scale + delta, true);
  }

  rotateBy(degrees: number): void {
    if (!this.#image.naturalWidth || !Number.isFinite(degrees)) return;
    this.rotation += degrees;
    if (this.zoom === "fit") this.#applyFit(false);
    else this.#constrainPan();
  }

  #connectListeners(): void {
    this.#listeners?.abort();
    const controller = new AbortController();
    const options = { signal: controller.signal };
    this.#listeners = controller;
    this.#image.addEventListener("load", () => this.#loaded(), options);
    this.#image.addEventListener("error", () => hirayaEvent(this, "hiraya-error", { src: this.src }), options);
    this.#viewport.addEventListener("keydown", (event) => this.#keyDown(event), options);
    this.#viewport.addEventListener("pointerdown", (event) => this.#pointerDown(event), options);
    this.#viewport.addEventListener("pointermove", (event) => this.#pointerMove(event), options);
    this.#viewport.addEventListener("pointerup", (event) => this.#pointerEnd(event), options);
    this.#viewport.addEventListener("pointercancel", (event) => this.#pointerEnd(event), options);
  }

  #syncAttributes(): void {
    this.#image.alt = this.alt;
    const nextSrc = this.src;
    if (this.isConnected && nextSrc !== this.#renderedSrc) {
      this.#renderedSrc = nextSrc;
      this.#panX = 0;
      this.#panY = 0;
      if (nextSrc) this.#image.src = nextSrc;
      else this.#image.removeAttribute("src");
    }
    const requested = this.zoom;
    if (requested === "fit") this.#applyFit(false);
    else this.#setScale(requested, false);
  }

  #loaded(): void {
    if (this.zoom === "fit") this.#applyFit(false);
    else this.#setScale(this.zoom, false);
    hirayaEvent(this, "hiraya-load", {
      src: this.src,
      naturalWidth: this.#image.naturalWidth,
      naturalHeight: this.#image.naturalHeight,
    });
  }

  #keyDown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "+" || event.key === "=") this.zoomBy(0.25);
    else if (event.key === "-") this.zoomBy(-0.25);
    else if (event.key === "0") this.reset();
    else if (event.key.toLowerCase() === "f") this.fit();
    else if (event.key === "ArrowLeft") this.#panBy(40, 0);
    else if (event.key === "ArrowRight") this.#panBy(-40, 0);
    else if (event.key === "ArrowUp") this.#panBy(0, 40);
    else if (event.key === "ArrowDown") this.#panBy(0, -40);
    else return;
    event.preventDefault();
  }

  #pointerDown(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    this.#viewport.focus({ preventScroll: true });
    this.#viewport.setPointerCapture(event.pointerId);
    this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.#viewport.toggleAttribute("data-panning", true);
    if (this.#pointers.size === 1) this.#lastPointer = { x: event.clientX, y: event.clientY };
    else if (this.#pointers.size === 2) this.#beginPinch();
  }

  #pointerMove(event: PointerEvent): void {
    if (!this.#pointers.has(event.pointerId)) return;
    this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.#pointers.size === 1 && this.#lastPointer) {
      this.#panX += event.clientX - this.#lastPointer.x;
      this.#panY += event.clientY - this.#lastPointer.y;
      this.#lastPointer = { x: event.clientX, y: event.clientY };
      this.#constrainPan();
    } else if (this.#pointers.size === 2) this.#updatePinch();
    event.preventDefault();
  }

  #pointerEnd(event: PointerEvent): void {
    if (!this.#pointers.delete(event.pointerId)) return;
    if (this.#viewport.hasPointerCapture(event.pointerId)) this.#viewport.releasePointerCapture(event.pointerId);
    const remaining = this.#pointers.values().next().value as Point | undefined;
    this.#lastPointer = remaining ? { ...remaining } : null;
    if (this.#pointers.size < 2) this.#gestureDistance = 0;
    this.#viewport.toggleAttribute("data-panning", this.#pointers.size > 0);
  }

  #beginPinch(): void {
    const [first, second] = [...this.#pointers.values()];
    if (!first || !second) return;
    this.#gestureDistance = Math.hypot(second.x - first.x, second.y - first.y);
    this.#gestureMidpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    this.#gestureScale = this.#scale;
    this.#gesturePan = { x: this.#panX, y: this.#panY };
  }

  #updatePinch(): void {
    const [first, second] = [...this.#pointers.values()];
    if (!first || !second || this.#gestureDistance <= 0) return;
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    const nextScale = clampImageZoom(this.#gestureScale * distance / this.#gestureDistance, this.minZoom, this.maxZoom);
    const rect = this.#viewport.getBoundingClientRect();
    const startX = this.#gestureMidpoint.x - rect.left - rect.width / 2;
    const startY = this.#gestureMidpoint.y - rect.top - rect.height / 2;
    const nextX = midpoint.x - rect.left - rect.width / 2;
    const nextY = midpoint.y - rect.top - rect.height / 2;
    const ratio = nextScale / this.#gestureScale;
    this.#panX = nextX - (startX - this.#gesturePan.x) * ratio;
    this.#panY = nextY - (startY - this.#gesturePan.y) * ratio;
    this.#setScale(nextScale, false, nextScale);
    const serialized = String(nextScale);
    if (this.getAttribute("zoom") !== serialized) this.setAttribute("zoom", serialized);
  }

  #panBy(x: number, y: number): void {
    this.#panX += x;
    this.#panY += y;
    this.#constrainPan();
  }

  #applyFit(announce: boolean): void {
    if (!this.#image.naturalWidth || !this.#viewport.clientWidth || !this.#viewport.clientHeight) return;
    this.#panX = 0;
    this.#panY = 0;
    const rotated = this.rotation % 180 !== 0;
    const scale = calculateImageFitZoom(
      this.#viewport.clientWidth,
      this.#viewport.clientHeight,
      rotated ? this.#image.naturalHeight : this.#image.naturalWidth,
      rotated ? this.#image.naturalWidth : this.#image.naturalHeight,
      this.minZoom,
      this.maxZoom,
    );
    this.#setScale(scale, announce, "fit");
  }

  #setNumericZoom(value: number, announce: boolean): void {
    const next = clampImageZoom(value, this.minZoom, this.maxZoom);
    const previous = this.#scale;
    if (previous > 0 && next !== previous) {
      this.#panX *= next / previous;
      this.#panY *= next / previous;
    }
    this.#setScale(next, announce, next);
    const serialized = String(next);
    if (this.getAttribute("zoom") !== serialized) this.setAttribute("zoom", serialized);
  }

  #setScale(value: number, announce: boolean, mode: HirayaImageZoom = this.zoom): void {
    const next = clampImageZoom(value, this.minZoom, this.maxZoom);
    const changed = next !== this.#scale;
    this.#scale = next;
    this.#constrainPan();
    if (changed || announce) hirayaEvent(this, "hiraya-zoom-change", { zoom: next, mode });
  }

  #constrainPan(): void {
    const rotated = this.rotation % 180 !== 0;
    const width = rotated ? this.#image.naturalHeight : this.#image.naturalWidth;
    const height = rotated ? this.#image.naturalWidth : this.#image.naturalHeight;
    const maxX = Math.max(0, (width * this.#scale - this.#viewport.clientWidth) / 2);
    const maxY = Math.max(0, (height * this.#scale - this.#viewport.clientHeight) / 2);
    this.#panX = Math.min(maxX, Math.max(-maxX, this.#panX));
    this.#panY = Math.min(maxY, Math.max(-maxY, this.#panY));
    this.#scheduleRender();
  }

  #scheduleRender(): void {
    if (this.#frame !== null) return;
    if (typeof requestAnimationFrame === "undefined") {
      this.#render();
      return;
    }
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      this.#render();
    });
  }

  #render(): void {
    this.#image.style.transform = `translate3d(calc(-50% + ${this.#panX}px), calc(-50% + ${this.#panY}px), 0) scale(${this.#scale}) rotate(${this.rotation}deg)`;
  }

  #positiveAttribute(name: string, fallback: number): number {
    const value = Number(this.getAttribute(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}

export function defineHirayaImageViewer(): void {
  defineElement("hiraya-image-viewer", HirayaImageViewer);
}
