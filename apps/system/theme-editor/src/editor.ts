import type { ThemeDefinition, ThemeEditorState, ThemeEditorTheme } from "@hiraya-team/apps-sdk";

export type ThemeDraft = {
  id: string;
  name: string;
  definition: ThemeDefinition;
  baseline: string | null;
};

export function backAction(editingDraft: boolean, wallpaperActive: boolean) {
  return editingDraft ? "draft" : wallpaperActive ? "theme" : "home";
}

function snapshot(name: string, definition: ThemeDefinition) {
  return JSON.stringify({ name, definition });
}

export function copyDraft(theme: ThemeEditorTheme, id = theme.id, name = theme.name, unsaved = false): ThemeDraft {
  const definition = structuredClone(theme.definition);
  return { id, name, definition, baseline: unsaved ? null : snapshot(name, definition) };
}

export function draftChanged(draft: ThemeDraft) {
  return draft.baseline === null || draft.baseline !== snapshot(draft.name, draft.definition);
}

export function nextCopyName(names: readonly string[], sourceName: string) {
  const used = new Set(names.map((name) => name.toLocaleLowerCase()));
  for (let number = 1; ; number += 1) {
    const suffix = number === 1 ? " copy" : ` copy ${number}`;
    const candidate = `${sourceName.slice(0, 60 - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

export function mergeThemeState(incoming: ThemeEditorState, draft: ThemeDraft | null) {
  return { state: structuredClone(incoming), draft };
}

function luminance(color: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(foreground: string, background: string) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function mix(foreground: string, background: string, ratio: number) {
  const channels = (color: string) => [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  const first = channels(foreground);
  const second = channels(background);
  return `#${first.map((channel, index) => Math.round(channel * ratio + second[index] * (1 - ratio)).toString(16).padStart(2, "0")).join("")}`;
}

function strongest(background: string, candidates: readonly string[]) {
  return candidates.reduce((best, candidate) => contrastRatio(candidate, background) > contrastRatio(best, background) ? candidate : best);
}

function strongestMinimum(backgrounds: readonly string[], candidates: readonly string[]) {
  const minimum = (candidate: string) => Math.min(...backgrounds.map((background) => contrastRatio(candidate, background)));
  return candidates.reduce((best, candidate) => minimum(candidate) > minimum(best) ? candidate : best);
}

export function contrastIssues(definition: ThemeDefinition) {
  const c = definition.colors;
  const minimumWindow = mix(c.window, c.shell, 0.65);
  const minimumMuted = mix(c.windowMuted, c.shell, 0.65);
  const minimumChrome = mix(c.chrome, c.shell, 0.65);
  const windowCandidates = [c.accent, c.selection, c.text, c.chromeText];
  const chromeCandidates = [c.accent, c.selection, c.chromeText, c.text];
  const accentOnWindow = strongestMinimum([c.window, minimumWindow], windowCandidates);
  const accentOnChrome = strongestMinimum([c.chrome, minimumChrome], chromeCandidates);
  const accentSurface = mix(accentOnWindow, c.window, 0.1);
  const status = strongestMinimum([c.window, minimumWindow], [c.accent, c.selection, c.text, c.chromeText]);
  const statusSurface = mix(status, c.window, 0.12);
  const readOnlySurface = mix(accentOnChrome, c.chrome, 0.12);
  const textPairs: Array<[string, string, string]> = [
    ["desktop text / desktop shell", c.desktopText, c.shell], ["text / window", c.text, c.window],
    ["text / minimum-opacity window", c.text, minimumWindow], ["text / window muted", c.text, c.windowMuted],
    ["text / minimum-opacity window muted", c.text, minimumMuted], ["muted text / window", c.textMuted, c.window],
    ["muted text / window muted", c.textMuted, c.windowMuted], ["text / blended selection", c.text, mix(c.selection, c.window, 0.23)],
    ["text / blended hover", c.text, mix(c.accent, c.window, 0.13)], ["chrome text / chrome", c.chromeText, c.chrome],
    ["chrome text / minimum-opacity chrome", c.chromeText, minimumChrome], ["chrome text / blended chrome control", c.chromeText, mix(c.chromeText, c.chrome, 0.09)],
    ["accent text / accent", c.accentText, c.accent], ["accent badge text / blended surface", strongest(accentSurface, [accentOnWindow, c.text, c.chromeText]), accentSurface],
    ["status badge text / blended surface", strongest(statusSurface, [status, c.text, c.chromeText]), statusSurface],
    ["read-only badge text / blended chrome", strongest(readOnlySurface, [accentOnChrome, c.chromeText, c.text]), readOnlySurface],
    ["danger foreground / danger", strongest(c.danger, [c.accentText, c.chromeText, c.text]), c.danger],
    ["danger text / danger surface", strongest(c.dangerSurface, [c.danger, c.text, c.chromeText]), c.dangerSurface],
    ["editor text / editor background", c.editorText, c.editorBackground], ["editor comment / editor background", c.editorComment, c.editorBackground],
    ["editor comment / editor gutter", c.editorComment, c.editorGutter], ["editor keyword / editor background", c.editorKeyword, c.editorBackground],
    ["editor string / editor background", c.editorString, c.editorBackground],
  ];
  const indicatorPairs: Array<[string, string, string]> = [
    ["accent indicator / window", accentOnWindow, c.window], ["accent indicator / minimum-opacity window", accentOnWindow, minimumWindow],
    ["accent indicator / chrome", accentOnChrome, c.chrome], ["accent indicator / minimum-opacity chrome", accentOnChrome, minimumChrome],
    ["focus / window", strongestMinimum([c.window, minimumWindow], windowCandidates), c.window],
    ["focus / minimum-opacity window", strongestMinimum([c.window, minimumWindow], windowCandidates), minimumWindow],
    ["focus / window muted", strongestMinimum([c.windowMuted, minimumMuted], windowCandidates), c.windowMuted],
    ["focus / minimum-opacity window muted", strongestMinimum([c.windowMuted, minimumMuted], windowCandidates), minimumMuted],
    ["focus / chrome", strongestMinimum([c.chrome, minimumChrome], chromeCandidates), c.chrome],
    ["focus / minimum-opacity chrome", strongestMinimum([c.chrome, minimumChrome], chromeCandidates), minimumChrome],
  ];
  return [
    ...textPairs.filter(([, foreground, background]) => contrastRatio(foreground, background) < 4.5).map(([label]) => label),
    ...indicatorPairs.filter(([, foreground, background]) => contrastRatio(foreground, background) < 3).map(([label]) => label),
  ];
}
