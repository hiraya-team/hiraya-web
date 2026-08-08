import type { FileHandle, HirayaClient, ThemeDefinition, ThemeEditorState, WallpaperEditorState, WallpaperEditorWallpaper } from "@hiraya-team/apps-sdk";
import { connectSystemApp, describeError, required, setAppLoading } from "@hiraya/system-apps-shared";
import { backAction, contrastIssues, copyDraft, draftChanged, editDraft, mergeThemeState, nextCopyName, type ThemeDraft } from "./editor";
import "./style.css";

type HirayaButton = HTMLElement & { disabled: boolean };
type ColorKey = keyof ThemeDefinition["colors"];

const APP_ID = "app.hiraya.theme-editor";
const HEX = /^#[\da-f]{6}$/i;
const content = required<HTMLElement>("#content");
const workspace = required<HTMLElement>("#workspace");
const loading = required<HTMLElement>("#loading");
const themeList = required<HTMLElement>("#theme-list");
const specimen = required<HTMLElement>("#specimen");
const form = required<HTMLFormElement>("#theme-form");
const nameInput = required<HTMLInputElement>("#theme-name");
const status = required<HTMLElement>("#status");
const deleteButton = required<HirayaButton>("#delete");
const wallpaperPanel = required<HTMLElement>("#wallpaper-panel");
const themePanel = required<HTMLElement>("#theme-panel");
const wallpaperFields = required<HTMLElement>("#wallpaper-fields");
const wallpaperUpload = required<HTMLInputElement>("#wallpaper-upload");
let hiraya: HirayaClient;
let state: ThemeEditorState | null = null;
let wallpaperState: WallpaperEditorState | null = null;
let draft: ThemeDraft | null = null;
let focusedThemeId = "";
let busy = false;
let wallpaperBusy = false;
let wallpaperSaveTimer: number | null = null;
let wallpaperImageUrl = "";
let wallpaperImageSource = "";
let wallpaperImageGeneration = 0;
let wallpaperSaveGeneration = 0;
let saveEnabled = false;

const DEFAULT_WALLPAPER: WallpaperEditorWallpaper = { source: "dusk", fit: "cover", positionX: 50, positionY: 50, blur: 0, dim: 0, overlayColor: "#000000", overlayOpacity: 0 };

const simpleColors: Array<[string, ColorKey, string, ColorKey]> = [
  ["Desktop", "shell", "Shell", "desktopText"],
  ["Chrome", "chromeText", "Surface", "chrome"],
  ["Window", "window", "Surface", "text"],
  ["Accent", "accent", "Fill", "accentText"],
];
const advancedColors: Array<[ColorKey, string]> = [
  ["windowMuted", "Muted window"], ["textMuted", "Muted text"], ["danger", "Danger fill"], ["dangerSurface", "Danger surface"],
  ["selection", "Selection"],
];

required("#simple-fields").innerHTML = `${simpleColors.map(([legend, first, firstLabel, second]) => `<fieldset><legend>${legend}</legend>${colorField(first, `${legend} ${firstLabel.toLowerCase()}`)}${colorField(second, `${legend} text`)}</fieldset>`).join("")}${colorField("border", "Border")}${numberField("shape.radius", "Corner radius", 0, 24, 1)}${numberField("effects.opacity", "Surface opacity", .65, 1, .01)}${selectField("typography.family", "Font family", [["system", "System"], ["humanist", "Humanist"], ["mono", "Monospace"]])}${numberField("density", "Interface density", .8, 1.2, .05)}`;
required("#advanced-fields").innerHTML = `${advancedColors.map(([key, label]) => colorField(key, label)).join("")}${numberField("shape.borderWidth", "Border width", 0, 2, .25)}${numberField("effects.blur", "Surface blur", 0, 30, 1)}${numberField("effects.shadow", "Shadow strength", 0, 1, .05)}<fieldset><legend>Surface treatment</legend><label class="toggle"><input id="treatment-enabled" type="checkbox"> Enable treatment</label><div id="treatment-fields">${numberField("treatment.gradientStrength", "Gradient strength", 0, 1, .05)}${selectField("treatment.gradientAngle", "Gradient angle", [0, 45, 90, 135, 180, 225, 270, 315].map((value) => [String(value), `${value} degrees`]))}${selectField("treatment.texture", "Texture", [["none", "None"], ["halftone", "Halftone"], ["dither", "Dither"]])}${numberField("treatment.textureStrength", "Texture strength", 0, 1, .05)}${numberField("treatment.textureScale", "Texture scale", 2, 12, 1)}<label class="toggle"><input data-path="treatment.pixelated" type="checkbox"> Pixelated treatment</label></div></fieldset>${numberField("typography.scale", "Type scale", .85, 1.2, .05)}${numberField("typography.weight", "Type weight", 400, 700, 100)}${numberField("motion", "Motion", 0, 1.5, .1)}${numberField("iconSize", "Desktop icon size", 48, 72, 1)}`;

required("#delete").addEventListener("click", () => void deleteTheme());
required("#cancel").addEventListener("click", () => void cancelEdit());
nameInput.addEventListener("input", () => { if (draft) { draft.name = nameInput.value; draftUpdated(); } });
form.addEventListener("input", handleFieldInput);
form.addEventListener("change", handleFieldInput);
required<HTMLInputElement>("#treatment-enabled").addEventListener("change", toggleTreatment);
required("#theme-tab").addEventListener("click", () => setInspectorMode("theme"));
required("#wallpaper-tab").addEventListener("click", () => setInspectorMode("wallpaper"));
required(".inspector-tabs").addEventListener("keydown", (event) => {
  if (!(event instanceof KeyboardEvent) || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const wallpaper = event.key === "ArrowRight" || event.key === "End";
  setInspectorMode(wallpaper ? "wallpaper" : "theme");
  required<HTMLElement>(wallpaper ? "#wallpaper-tab" : "#theme-tab").focus();
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-wallpaper-source]")) button.addEventListener("click", () => void saveWallpaper({ source: button.dataset.wallpaperSource! }));
required("#wallpaper-upload-button").addEventListener("click", () => wallpaperUpload.click());
required("#wallpaper-image-button").addEventListener("click", () => void chooseWallpaper());
required("#wallpaper-reset").addEventListener("click", () => void saveWallpaper(DEFAULT_WALLPAPER, true));
wallpaperUpload.addEventListener("change", () => void uploadWallpaper());
wallpaperFields.addEventListener("input", wallpaperFieldChanged);
wallpaperFields.addEventListener("change", wallpaperFieldChanged);
for (const input of wallpaperFields.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")) input.addEventListener("blur", () => void commitWallpaper());
addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (draft) void saveTheme(); }
  if (event.key === "Escape" && draft) { event.preventDefault(); void cancelEdit(); }
});
void start();

function colorField(key: ColorKey, label: string) {
  return `<label class="color-field"><span>${label}</span><span class="color-pair"><input type="color" data-color="${key}" aria-label="${label} color picker"><input class="hex-input" data-color="${key}" aria-label="${label} hex color" maxlength="7" pattern="#[0-9A-Fa-f]{6}" spellcheck="false"></span></label>`;
}

function numberField(path: string, label: string, min: number, max: number, step: number) {
  return `<label class="number-field"><span>${label}</span><input type="number" data-path="${path}" min="${min}" max="${max}" step="${step}"></label>`;
}

function selectField(path: string, label: string, options: string[][]) {
  return `<label class="number-field"><span>${label}</span><select data-path="${path}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select></label>`;
}

async function start() {
  try {
    const app = await connectSystemApp(APP_ID);
    hiraya = app.hiraya;
    await hiraya.app.setBackHandler(async () => {
      const action = backAction(Boolean(draft), !wallpaperPanel.hidden);
      if (action === "draft") await cancelEdit();
      else if (action === "theme") setInspectorMode("theme");
      return action === "home" ? "home" : "handled";
    });
    app.onDispose(() => {
      void hiraya.app.clearBackHandler().catch(() => undefined);
      state = null;
      wallpaperState = null;
      if (wallpaperSaveTimer !== null) clearTimeout(wallpaperSaveTimer);
      if (wallpaperImageUrl) URL.revokeObjectURL(wallpaperImageUrl);
    });
    hiraya.on("themes.changed", (incoming) => {
      const merged = mergeThemeState(incoming, draft);
      state = merged.state;
      draft = merged.draft;
      if (!draft && !state.themes.some((theme) => theme.id === focusedThemeId)) focusedThemeId = state.selectedThemeId || state.themes[0]?.id || "";
      render();
      setStatus(draft ? "The theme library changed elsewhere. Your draft is preserved." : "Theme library updated.");
    });
    hiraya.on("commands.invoked", ({ id }) => id === "edit" ? void beginEdit() : id === "duplicate" ? void duplicateTheme() : id === "save" ? void saveTheme() : undefined);
    hiraya.on("wallpapers.changed", (incoming) => {
      const sourceChanged = incoming.wallpaper.source !== wallpaperState?.wallpaper.source;
      wallpaperState = incoming;
      renderWallpaper();
      renderPreview();
      if (sourceChanged) void refreshWallpaperImage();
    });
    [state, wallpaperState] = await Promise.all([hiraya.themes.getState(), hiraya.wallpapers.getState()]);
    focusedThemeId = state.selectedThemeId || state.themes[0]?.id || "";
    const theme = selectedTheme();
    draft = theme && state.canManage ? editDraft(theme, state.themes.map((item) => item.name)) : null;
    await setDirty(Boolean(draft && draftChanged(draft)));
    setAppLoading(content, workspace, loading);
    render();
    void refreshWallpaperImage();
    setStatus(state.canManage ? "Edit the selected theme, then save and apply it." : state.restrictionReason || "Theme management is restricted.", !state.canManage);
  } catch (error) {
    setAppLoading(content, workspace, loading);
    workspace.classList.add("has-fatal");
    required<HTMLElement>("#fatal").hidden = false;
    required<HTMLElement>("#fatal-message").textContent = describeError(error, "The theme library could not be loaded.");
    setStatus("Theme Editor could not start.", true);
  }
}

function selectedTheme() {
  return state?.themes.find((theme) => theme.id === focusedThemeId) ?? null;
}

function previewDefinition() {
  return draft?.definition ?? selectedTheme()?.definition ?? null;
}

function render() {
  if (!state) return;
    renderLibrary();
    renderPreview();
    renderInspector();
    renderWallpaper();
    renderControls();
}

function renderLibrary() {
  if (!state) return;
  const current = state;
  required("#theme-count").textContent = `${current.themes.length}`;
  themeList.replaceChildren(...current.themes.map((theme) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-item";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(theme.id === focusedThemeId));
    button.dataset.themeId = theme.id;
    button.tabIndex = theme.id === focusedThemeId ? 0 : -1;
    if (theme.id === focusedThemeId) button.classList.add("focused");
    button.innerHTML = `<span class="theme-swatch" aria-hidden="true"></span><span><strong></strong><small></small></span><span class="selected-mark"></span>`;
    button.style.setProperty("--swatch-shell", theme.definition.colors.shell);
    button.style.setProperty("--swatch-accent", theme.definition.colors.accent);
    button.querySelector("strong")!.textContent = theme.name;
    button.querySelector("small")!.textContent = theme.builtIn ? "Built-in" : "Custom";
    button.querySelector(".selected-mark")!.textContent = theme.id === current.selectedThemeId ? "Applied" : "";
    button.addEventListener("click", () => void focusTheme(theme.id));
    button.addEventListener("keydown", (event) => { if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) { event.preventDefault(); void moveThemeFocus(event.key); } });
    return button;
  }));
  const restriction = required<HTMLElement>("#restriction");
  restriction.hidden = current.canManage;
  restriction.textContent = current.restrictionReason || "Theme management is unavailable in this desktop.";
}

function renderPreview() {
  const definition = previewDefinition();
  const empty = required<HTMLElement>("#preview-empty");
  empty.hidden = Boolean(definition);
  specimen.hidden = !definition;
  if (!definition) return;
  const c = definition.colors;
  const values: Record<string, string> = {
    "--preview-shell": c.shell, "--preview-desktop-text": c.desktopText, "--preview-chrome": c.chrome,
    "--preview-chrome-text": c.chromeText, "--preview-window": c.window, "--preview-window-muted": c.windowMuted,
    "--preview-text": c.text, "--preview-text-muted": c.textMuted, "--preview-accent": c.accent,
    "--preview-accent-text": c.accentText, "--preview-border": c.border, "--preview-selection": c.selection,
    "--preview-radius": `${definition.shape.radius}px`, "--preview-border-width": `${definition.shape.borderWidth}px`,
    "--preview-shadow": String(definition.effects.shadow), "--preview-opacity": String(definition.effects.opacity),
    "--preview-density": String(definition.density), "--preview-scale": String(definition.typography.scale),
    "--preview-weight": String(definition.typography.weight), "--preview-icon-size": `${definition.iconSize}px`,
    "--preview-family": definition.typography.family === "mono" ? "ui-monospace, monospace" : definition.typography.family === "humanist" ? "'Segoe UI', ui-sans-serif, sans-serif" : "ui-sans-serif, system-ui, sans-serif",
  };
  for (const [property, value] of Object.entries(values)) specimen.style.setProperty(property, value);
  const wallpaper = wallpaperState?.wallpaper;
  if (wallpaper) {
    specimen.dataset.wallpaper = wallpaper.source.startsWith("file:") ? "file" : wallpaper.source.startsWith("theme:") ? "theme" : wallpaper.source;
    specimen.style.setProperty("--wallpaper-image", wallpaperImageUrl ? `url(${wallpaperImageUrl})` : "none");
    specimen.style.setProperty("--wallpaper-fit", wallpaper.fit);
    specimen.style.setProperty("--wallpaper-x", `${wallpaper.positionX}%`);
    specimen.style.setProperty("--wallpaper-y", `${wallpaper.positionY}%`);
    specimen.style.setProperty("--wallpaper-blur", `${wallpaper.blur * .55}px`);
    specimen.style.setProperty("--wallpaper-dim", String(wallpaper.dim));
    specimen.style.setProperty("--wallpaper-overlay", wallpaper.overlayColor);
    specimen.style.setProperty("--wallpaper-overlay-opacity", String(wallpaper.overlayOpacity));
  }
  required("#preview-kind").textContent = draft ? "Draft preview" : selectedTheme()?.builtIn ? "Built-in" : "Custom";
}

function renderInspector() {
  const empty = required<HTMLElement>("#inspector-empty");
  empty.hidden = Boolean(draft);
  form.hidden = !draft;
  if (!draft) { saveEnabled = false; return; }
  nameInput.value = draft.name;
  for (const input of form.querySelectorAll<HTMLInputElement>("[data-color]")) input.value = draft.definition.colors[input.dataset.color as ColorKey];
  for (const input of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-path]")) {
    const value = getPath(draft.definition, input.dataset.path!);
    if (input instanceof HTMLInputElement && input.type === "checkbox") input.checked = Boolean(value);
    else input.value = String(value ?? "");
  }
  const treatmentEnabled = required<HTMLInputElement>("#treatment-enabled");
  treatmentEnabled.checked = Boolean(draft.definition.treatment);
  for (const input of required("#treatment-fields").querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")) input.disabled = !treatmentEnabled.checked;
  validateDraft();
}

function renderWallpaper() {
  if (!wallpaperState) return;
  const current = wallpaperState;
  required("#wallpaper-current").textContent = `Current: ${current.currentName}`;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-wallpaper-source]")) {
    button.setAttribute("aria-pressed", String(button.dataset.wallpaperSource === current.wallpaper.source));
    button.disabled = !current.canManage || wallpaperBusy;
  }
  for (const input of wallpaperPanel.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input,select,button")) input.disabled = !current.canManage || wallpaperBusy;
  for (const input of wallpaperFields.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-wallpaper-field]")) {
    const value = current.wallpaper[input.dataset.wallpaperField as keyof WallpaperEditorWallpaper];
    input.value = String(value);
    input.closest("label")?.querySelector("output")?.replaceChildren(String(value));
  }
  required<HTMLInputElement>("[data-wallpaper-hex]").value = current.wallpaper.overlayColor;
  const restriction = required<HTMLElement>("#wallpaper-restriction");
  restriction.hidden = current.canManage;
  restriction.textContent = current.restrictionReason;
}

function renderControls() {
  const theme = selectedTheme();
  const canManage = Boolean(state?.canManage) && !busy;
  const editEnabled = Boolean(theme && canManage && !draft);
  const duplicateEnabled = Boolean(theme && canManage);
  deleteButton.disabled = !theme || theme.builtIn || !canManage || Boolean(draft);
  deleteButton.toggleAttribute("aria-busy", busy);
  required("#mode-badge").textContent = draft ? "Editing" : "Library";
  required("#dirty-label").textContent = draft && draftChanged(draft) ? "Unsaved" : "";
  void hiraya?.commands.set([
    { id: "edit", title: "Edit", enabled: editEnabled, promoted: !draft },
    { id: "duplicate", title: "Duplicate", enabled: duplicateEnabled, promoted: true },
    { id: "save", title: "Save and Apply", shortcut: "Ctrl+S", enabled: Boolean(draft) && saveEnabled && !busy, promoted: Boolean(draft) },
  ]);
}

function setInspectorMode(mode: "theme" | "wallpaper") {
  const wallpaper = mode === "wallpaper";
  themePanel.hidden = wallpaper;
  wallpaperPanel.hidden = !wallpaper;
  required("#theme-tab").setAttribute("aria-selected", String(!wallpaper));
  required("#wallpaper-tab").setAttribute("aria-selected", String(wallpaper));
  required<HTMLElement>("#theme-tab").tabIndex = wallpaper ? -1 : 0;
  required<HTMLElement>("#wallpaper-tab").tabIndex = wallpaper ? 0 : -1;
  if (wallpaper) void refreshWallpaperImage();
}

async function moveThemeFocus(key: string) {
  if (!state?.themes.length) return;
  const current = Math.max(0, state.themes.findIndex((theme) => theme.id === focusedThemeId));
  const index = key === "Home" ? 0 : key === "End" ? state.themes.length - 1 : (current + (key === "ArrowDown" ? 1 : -1) + state.themes.length) % state.themes.length;
  const id = state.themes[index].id;
  await focusTheme(id);
  themeList.querySelector<HTMLElement>(`[data-theme-id="${CSS.escape(id)}"]`)?.focus();
}

async function confirmDiscard() {
  return !draft || !draftChanged(draft) || hiraya.dialogs.confirm({ title: "Discard theme changes?", message: "This draft has changes that have not been saved.", confirmLabel: "Discard", destructive: true });
}

async function focusTheme(id: string) {
  if (id === focusedThemeId && !draft) return;
  if (!await confirmDiscard()) return;
  focusedThemeId = id;
  const theme = selectedTheme();
  draft = theme && state?.canManage ? editDraft(theme, state.themes.map((item) => item.name)) : null;
  await setDirty(Boolean(draft && draftChanged(draft)));
  render();
}

async function beginEdit() {
  const theme = selectedTheme();
  if (!theme || !state?.canManage || !await confirmDiscard()) return;
  draft = editDraft(theme, state.themes.map((item) => item.name));
  render();
  await setDirty(draftChanged(draft));
  nameInput.focus();
}

async function duplicateTheme() {
  const theme = selectedTheme();
  if (!theme || !state?.canManage || !await confirmDiscard()) return;
  const names = state.themes.map((item) => item.name);
  draft = copyDraft(theme, crypto.randomUUID(), nextCopyName(names, theme.name), true);
  render();
  await setDirty(true);
  nameInput.select();
}

async function cancelEdit() {
  if (!await confirmDiscard()) return;
  draft = null;
  await setDirty(false);
  render();
  setStatus("Draft discarded.");
}

async function saveTheme() {
  if (!draft || !state?.canManage || !saveEnabled || busy) return;
  const saving = draft;
  await run("Saving theme...", async () => {
    state = await hiraya.themes.save({ id: saving.id, name: saving.name.trim(), definition: saving.definition });
    focusedThemeId = saving.id;
    const saved = selectedTheme();
    draft = saved ? editDraft(saved, state.themes.map((item) => item.name)) : null;
    await setDirty(false);
    setStatus(`${saving.name.trim()} saved and applied.`);
  }, "The theme could not be saved.");
}

async function deleteTheme() {
  const theme = selectedTheme();
  if (!theme || theme.builtIn || !state?.canManage || busy) return;
  const confirmed = await hiraya.dialogs.confirm({ title: `Delete ${theme.name}?`, message: "This custom theme will be removed from the desktop.", confirmLabel: "Delete", destructive: true });
  if (!confirmed) return;
  await run("Deleting theme...", async () => {
    state = await hiraya.themes.delete(theme.id);
    focusedThemeId = state.selectedThemeId || state.themes[0]?.id || "";
    setStatus(`${theme.name} deleted.`);
  }, "The theme could not be deleted.");
}

async function run(message: string, operation: () => Promise<void>, fallback: string) {
  busy = true;
  setStatus(message);
  renderControls();
  try { await operation(); }
  catch (error) { setStatus(describeError(error, fallback), true); }
  finally { busy = false; render(); }
}

function handleFieldInput(event: Event) {
  if (!draft || !(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) return;
  const input = event.target;
  if (input.id === "treatment-enabled") return;
  if (input.dataset.color) {
    const value = input.value.toLowerCase();
    for (const peer of form.querySelectorAll<HTMLInputElement>(`[data-color="${input.dataset.color}"]`)) if (peer !== input && (input.type === "color" || HEX.test(value))) peer.value = value;
    input.setAttribute("aria-invalid", String(!HEX.test(value)));
    if (HEX.test(value)) draft.definition.colors[input.dataset.color as ColorKey] = value;
  } else if (input.dataset.path) {
    const value = input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : input instanceof HTMLInputElement && input.type === "number" ? Number(input.value) : input.value;
    setPath(draft.definition, input.dataset.path, value);
  }
  draftUpdated();
}

function toggleTreatment(event: Event) {
  if (!draft || !(event.target instanceof HTMLInputElement)) return;
  draft.definition.treatment = event.target.checked ? { gradientStrength: 0, gradientAngle: 0, texture: "none", textureStrength: 0, textureScale: 4, pixelated: false } : undefined;
  renderInspector();
  draftUpdated();
}

function draftUpdated() {
  renderPreview();
  validateDraft();
  renderControls();
  void setDirty(Boolean(draft && draftChanged(draft)));
}

function validateDraft() {
  if (!draft) return;
  const invalidHex = [...form.querySelectorAll<HTMLInputElement>(".hex-input")].some((input) => !HEX.test(input.value));
  const issues = invalidHex ? ["invalid hex color"] : contrastIssues(draft.definition);
  const validation = required<HTMLElement>("#contrast-error");
  validation.hidden = issues.length === 0;
  validation.textContent = issues.length ? `Save is blocked. Improve contrast for: ${issues.join(", ")}.` : "";
  saveEnabled = !busy && Boolean(state?.canManage) && form.checkValidity() && Boolean(draft.name.trim()) && draft.name.trim() === draft.name && issues.length === 0;
}

function wallpaperFieldChanged(event: Event) {
  if (!wallpaperState || !(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) return;
  const input = event.target;
  const field = input.dataset.wallpaperField as keyof WallpaperEditorWallpaper | undefined;
  if (input.hasAttribute("data-wallpaper-hex")) {
    const value = input.value.toUpperCase();
    input.setAttribute("aria-invalid", String(!HEX.test(value)));
    if (!HEX.test(value)) return;
    wallpaperState.wallpaper.overlayColor = value;
    required<HTMLInputElement>('[data-wallpaper-field="overlayColor"]').value = value;
  } else if (field) {
    const value = input.type === "range" ? Number(input.value) : input.value;
    Object.assign(wallpaperState.wallpaper, { [field]: value });
    if (field === "overlayColor") required<HTMLInputElement>("[data-wallpaper-hex]").value = String(value).toUpperCase();
  } else return;
  renderWallpaper();
  renderPreview();
  void hiraya.wallpapers.preview(wallpaperState.wallpaper).catch((error) => setStatus(describeError(error, "The wallpaper preview could not be updated."), true));
  if (wallpaperSaveTimer !== null) clearTimeout(wallpaperSaveTimer);
  wallpaperSaveTimer = window.setTimeout(() => { wallpaperSaveTimer = null; void commitWallpaper(); }, 400);
}

async function commitWallpaper() {
  if (!wallpaperState || !wallpaperState.canManage || wallpaperBusy) return;
  if (wallpaperSaveTimer !== null) clearTimeout(wallpaperSaveTimer);
  wallpaperSaveTimer = null;
  const generation = ++wallpaperSaveGeneration;
  const wallpaper = structuredClone(wallpaperState.wallpaper);
  setStatus("Saving wallpaper...");
  try {
    const saved = await hiraya.wallpapers.save(wallpaper);
    if (generation !== wallpaperSaveGeneration) return;
    wallpaperState = saved;
    renderWallpaper();
    renderPreview();
    setStatus(`${saved.currentName} wallpaper applied.`);
  } catch (error) {
    if (generation !== wallpaperSaveGeneration) return;
    wallpaperState = await hiraya.wallpapers.getState().catch(() => wallpaperState);
    renderWallpaper();
    renderPreview();
    setStatus(describeError(error, "The wallpaper could not be saved."), true);
  }
}

async function saveWallpaper(change: Partial<WallpaperEditorWallpaper>, reset = false) {
  if (!wallpaperState || !wallpaperState.canManage || wallpaperBusy) return;
  wallpaperSaveGeneration += 1;
  const wallpaper = reset ? structuredClone(DEFAULT_WALLPAPER) : { ...wallpaperState.wallpaper, ...change };
  await runWallpaper("Saving wallpaper...", async () => {
    wallpaperState = await hiraya.wallpapers.save(wallpaper);
    renderWallpaper();
    renderPreview();
    await refreshWallpaperImage();
    setStatus(`${wallpaperState.currentName} wallpaper applied.`);
  }, "The wallpaper could not be saved.");
}

async function uploadWallpaper() {
  const file = wallpaperUpload.files?.[0];
  wallpaperUpload.value = "";
  if (!file || !wallpaperState?.canManage || wallpaperBusy) return;
  wallpaperSaveGeneration += 1;
  await runWallpaper("Adding wallpaper image...", async () => {
    wallpaperState = await hiraya.wallpapers.upload(file.name, file.type, await file.arrayBuffer());
    renderWallpaper();
    renderPreview();
    await refreshWallpaperImage();
    setStatus(`${file.name} added and applied.`);
  }, "The wallpaper image could not be added.");
}

async function chooseWallpaper() {
  const handles = await hiraya.dialogs.openFile({ mimeTypes: ["image/jpeg", "image/png", "image/webp"] }).catch((error) => {
    setStatus(describeError(error, "The Hiraya file picker could not be opened."), true);
    return null;
  });
  if (handles?.[0]) await selectWallpaper(handles[0]);
}

async function selectWallpaper(handle: FileHandle) {
  if (!wallpaperState?.canManage || wallpaperBusy) return;
  wallpaperSaveGeneration += 1;
  await runWallpaper("Applying wallpaper image...", async () => {
    wallpaperState = await hiraya.wallpapers.select(handle);
    renderWallpaper();
    renderPreview();
    await refreshWallpaperImage();
    setStatus(`${wallpaperState.currentName} applied.`);
  }, "The wallpaper image could not be applied.");
}

async function refreshWallpaperImage() {
  const source = wallpaperState?.wallpaper.source ?? "";
  if (source === wallpaperImageSource) return;
  wallpaperImageSource = source;
  const generation = ++wallpaperImageGeneration;
  const image = await hiraya.wallpapers.readCurrentImage().catch(() => null);
  if (generation !== wallpaperImageGeneration) return;
  if (wallpaperImageUrl) URL.revokeObjectURL(wallpaperImageUrl);
  wallpaperImageUrl = image ? URL.createObjectURL(new Blob([image.data], { type: image.mimeType })) : "";
  renderPreview();
}

async function runWallpaper(message: string, operation: () => Promise<void>, fallback: string) {
  wallpaperBusy = true;
  setStatus(message);
  renderWallpaper();
  try { await operation(); }
  catch (error) { setStatus(describeError(error, fallback), true); }
  finally { wallpaperBusy = false; renderWallpaper(); }
}

function getPath(target: ThemeDefinition, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], target);
}

function setPath(target: ThemeDefinition, path: string, value: unknown) {
  const keys = path.split(".");
  let owner = target as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) owner = owner[key] as Record<string, unknown>;
  owner[keys.at(-1)!] = value;
}

async function setDirty(dirty: boolean) {
  await hiraya?.window.setDirty(dirty);
}

function setStatus(message: string, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}
