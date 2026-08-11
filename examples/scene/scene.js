const lantern = document.querySelector("#lantern");
lantern.addEventListener("click", () => {
  const lit = lantern.getAttribute("aria-pressed") !== "true";
  lantern.setAttribute("aria-pressed", String(lit));
  lantern.textContent = lit ? "Lantern lit" : "Light the lantern";
});
