import { defineHirayaElements } from "./elements";

defineHirayaElements();

function applyFoundationClass(): void {
  document.body?.classList.add("hiraya-app");
}

if (typeof document !== "undefined") {
  if (document.body) applyFoundationClass();
  else document.addEventListener("DOMContentLoaded", applyFoundationClass, { once: true });
}
