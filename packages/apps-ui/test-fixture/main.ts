import { defineHirayaElements, type HirayaActionSheet, type HirayaDialog, type HirayaImageViewer } from "../src/elements";
import "../src/styles.css";

defineHirayaElements();

const dialog = document.querySelector<HirayaDialog>("#dialog")!;
const sheet = document.querySelector<HirayaActionSheet>("#sheet")!;
const image = document.querySelector<HirayaImageViewer>("#image")!;
const selection = document.querySelector<HTMLOutputElement>("#selection")!;
const itemEvent = document.querySelector<HTMLOutputElement>("#item-event")!;

document.querySelector("#dialog-trigger")?.addEventListener("click", () => dialog.showModal());
document.querySelector("[data-close]")?.addEventListener("click", () => dialog.close("button"));
document.querySelector("#sheet-trigger")?.addEventListener("click", () => sheet.showModal());
document.addEventListener("hiraya-select", (event) => {
  selection.value = (event as CustomEvent<{ value: string }>).detail.value;
});

image.src = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#173028"/><circle cx="320" cy="180" r="90" fill="#e2aa52"/></svg>')}`;

document.querySelector("#item-list")?.addEventListener("hiraya-item-select", (event) => {
  itemEvent.value = `selected ${(event as CustomEvent<{ id: string }>).detail.id}`;
});
document.querySelector("#item-list")?.addEventListener("hiraya-item-activate", (event) => {
  itemEvent.value = `activated ${(event as CustomEvent<{ id: string }>).detail.id}`;
});
document.querySelector("#reorder-list")?.addEventListener("hiraya-item-reorder", (event) => {
  const detail = (event as CustomEvent<{ id: string; toIndex: number }>).detail;
  itemEvent.value = `moved ${detail.id} to ${detail.toIndex}`;
});
document.querySelector("#item-list")?.addEventListener("hiraya-item-context", (event) => {
  itemEvent.value = `context ${(event as CustomEvent<{ id: string }>).detail.id}`;
});
