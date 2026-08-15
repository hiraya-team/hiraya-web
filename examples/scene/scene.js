const lantern = document.querySelector("#lantern");
const status = document.querySelector("#pointer-status");
lantern.addEventListener("click", () => {
  const lit = lantern.getAttribute("aria-pressed") !== "true";
  lantern.setAttribute("aria-pressed", String(lit));
  lantern.textContent = lit ? "Lantern lit" : "Light the lantern";
});

addEventListener("hiraya:wallpaper-pointer", (event) => {
  const { phase, x, y } = event.detail;
  status.textContent = `${phase} at ${Math.round(x)}, ${Math.round(y)}`;
});
