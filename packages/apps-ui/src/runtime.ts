import { defineHirayaElements } from "./elements";

defineHirayaElements();

/** Applies the Hiraya foundation styles to the document body. */
function applyFoundationClass(): void {
  document.body?.classList.add("hiraya-app");
}

if (typeof document !== "undefined") {
  if (document.body) applyFoundationClass();
  else document.addEventListener("DOMContentLoaded", applyFoundationClass, { once: true });
}
