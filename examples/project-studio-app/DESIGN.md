---
name: Project Studio
description: A quiet, responsive writing instrument for portable Hiraya publications.
colors:
  background: "var(--hiraya-background)"
  surface: "var(--hiraya-surface)"
  surface-elevated: "var(--hiraya-surface-elevated)"
  text: "var(--hiraya-text)"
  text-muted: "var(--hiraya-text-muted)"
  border: "var(--hiraya-border)"
  accent: "var(--hiraya-accent)"
  accent-text: "var(--hiraya-accent-text)"
  danger: "var(--hiraya-danger)"
  focus: "var(--hiraya-focus)"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(2.45rem, 12vw, 5.8rem)"
    fontWeight: 700
    lineHeight: 0.92
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(1.75rem, 8vw, 2.7rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.04em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.35rem"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "-0.025em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.5
  editor:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
rounded:
  row: "0.4rem"
  control: "0.5rem"
  panel: "0.55rem"
  pill: "99rem"
  circle: "50%"
spacing:
  1: "0.25rem"
  2: "0.5rem"
  3: "0.75rem"
  4: "1rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 0.85rem"
    height: "var(--studio-control)"
  button-secondary:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 0.85rem"
    height: "var(--studio-control)"
  text-field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    rounded: "{rounded.row}"
    padding: "0 0.7rem"
    height: "var(--studio-control)"
---

# Design System: Project Studio

## Overview

**Creative North Star: "The Quiet Writing Instrument"**

Project Studio is a content-led Hiraya tool, not a miniature IDE or a generic dashboard. Its focus deck keeps the current writing task primary, then docks project and publication tools around that task as space permits. Restrained chrome, compact status, amber-accented actions, and Phosphor icons make the interface feel precise without competing with the document.

The app inherits Hiraya's runtime theme rather than owning a fixed palette. Density is purposeful: controls remain touchable on phones and tighten only in wide three-pane windows. State must always be explicit because preserved drafts, conflicts, read-only access, preview materialization, and local publication are core product truths.

**Key Characteristics:**

- One primary task at every width, with progressively disclosed rails.
- Semantic Hiraya color tokens and system fonts; no runtime font or palette override.
- Flat, bordered work surfaces with elevation reserved for temporary or focal layers.
- Compact but accessible controls, visible focus, and text-first hierarchy.

## Colors

The host-resolved `--hiraya-*` tokens are the color source of truth and change with the runtime theme; `color-scheme: light dark` is supported. Never replace them with app-local fixed colors.

### Primary

- **Hiraya Accent:** Marks primary actions, active files and modes, dirty state, carets, and focal iconography. Pair accent fills only with the matching accent-text token.

### Tertiary

- **Hiraya Danger:** Signals conflicts, failed status, and destructive text. Conflict backgrounds tint danger into the current surface instead of introducing a new red.

### Neutral

- **Background:** The editor and deepest work canvas.
- **Surface:** Header, rails, status bar, and other structural chrome.
- **Elevated Surface:** Controls, forms, and mobile navigation that must separate from their parent surface.
- **Text and Muted Text:** Text is reserved for active content; muted text carries paths, counts, descriptions, metadata, and inactive navigation.
- **Border:** A one-pixel structural divider for panes, toolbars, forms, tabs, and data groups.
- **Focus:** A dedicated high-contrast focus ring, independent of selection color.

**The Semantic Palette Rule.** Selection, focus, danger, and elevation keep distinct roles across every host theme; do not infer one role from another.

**The Accent Rarity Rule.** Use accent for current state and consequential action, not as decoration or a general surface fill.

## Typography

**Display and Body Font:** Native UI sans-serif stack.

**Editor Font:** Native monospace stack; user-selectable from 13px to 20px, with 15px as the default.

**Character:** Familiar system typography keeps the tool fast and desktop-native. Tight display tracking gives welcome and publication moments authority, while ordinary work UI stays compact, legible, and unstyled enough to recede.

### Hierarchy

- **Display:** Reserved for the project-opening welcome statement; balanced, short, and visually dominant.
- **Headline:** Used for the publication outcome or similarly singular task statement, capped near 12 characters per line.
- **Title:** Used in empty tasks and compact callouts, not as repeated pane decoration.
- **Body:** Default interface and explanatory copy; prose is generally constrained to 34-52 characters per line.
- **Label:** Small, bold metadata, field labels, navigation captions, and status badges; sentence case, never decorative uppercase.
- **Editor:** Monospace with generous line height, two-space tabs, optional wrapping, and an accent caret.

**The Content Owns the Scale Rule.** Large type announces only a workflow threshold; files, controls, tabs, and status remain compact so the document stays primary.

## Layout

The shell is a viewport-height grid with a 3.75rem header, flexible workspace, 2.25rem status bar, and, on narrow screens, a 4.5rem mode deck. Use dynamic viewport units and safe-area insets; scrolling belongs inside the active pane, file tree, publication detail, or welcome content, never on the body.

The focus-deck topology has three deliberate states:

- **Below 48rem:** Show exactly one of Files, Write, Preview, or Publish. A four-mode bottom deck remains in thumb reach. Below 30rem, header actions become icon-only and the brand subtitle disappears.
- **48rem to 67.999rem:** Keep the project rail (13-16rem) and editor visible. Preview or Publish opens as a right-side deck, up to 34rem or 55vw, above the editor without changing task hierarchy.
- **68rem and above:** Show the full three-pane workspace: a 13-15rem project rail, editor with a 26rem minimum, and a 20rem-to-32%-wide publication rail. Controls compact from 2.75rem to 2.35rem only here.

Spacing follows the inherited 0.25rem rhythm with 0.5rem, 0.75rem, and 1rem as the recurring steps. Dense rows use approximately 0.4-0.75rem internal spacing; task-level empty and publication surfaces may expand with responsive `clamp()` padding. Primary touch controls remain at least 2.75rem (44px) before the wide-window density shift.

**The Same Hierarchy Rule.** Responsive changes move and dock surfaces; they do not reorder the workflow or shrink a desktop IDE into a phone.

## Elevation & Depth

The system is flat by default. One-pixel borders and tonal surface changes define permanent structure. Shadows identify only temporary overlap or a singular focal object: the intermediate publication deck casts a leftward shadow, preview refresh sits in a reserved footer below its frame, and the welcome or publish mark receives a diffuse ambient lift. Never shadow every pane or control.

**The Structural Before Atmospheric Rule.** Use borders and semantic surfaces first; add shadow only when overlap or focal depth would otherwise be ambiguous.

## Shapes

Controls and rows use restrained curves between 0.4rem and 0.55rem. Pills are limited to compact status badges, circles to focal marks and empty-state icon wells. Panes stay rectilinear and meet at one-pixel borders; they are not floating cards. The isolated publication preview may use its own warm paper canvas, but surrounding chrome remains theme-native.

## Components

### Controls and Fields

- Secondary controls use elevated surfaces, one-pixel borders, and restrained 0.5rem corners; primary controls use accent fill and bold accent-text.
- Fine-pointer hover is a subtle brightness increase or low-opacity semantic tint. Do not make hover the only indication of state.
- Every keyboard target uses a 3px focus outline with a 2px offset; the full-bleed editor places the same outline inward.
- Disabled actions retain their layout, use reduced opacity, and show a non-interactive cursor. Read-only mode also appears as explicit status text and a badge.

### Navigation and Selection

- Active tabs and publication modes use accent text with a 2px inset underline. Active files and mobile modes use a low-opacity accent tint plus accent text.
- Dirty documents use a small accent dot with an accessible label. Inactive destinations use muted text, never reduced hit area.
- Mobile mode buttons combine icon and short label; wide-window rails preserve the same names and hierarchy.

### Surfaces and States

- Structural surfaces are background, surface, or elevated-surface layers separated by one-pixel borders.
- Empty states center one action and concise guidance. Initialization stays left-aligned because it changes project structure.
- Conflicts use a danger-tinted surface, preserved-draft language, and three explicit resolution choices; destructive replacement remains visually distinct.
- Status is persistent, single-line, and live-announced. Success and progress use accent iconography; failures use danger; read-only state never relies on disabled controls alone.

### Motion

- Motion is functional and sparse. The only continuous motion is the 0.85s linear progress spin.
- Avoid entrance, pane, and decorative animation; direct state changes suit the desktop context.
- Under `prefers-reduced-motion`, animation and transition durations collapse to 0.01ms, iteration counts to one, and smooth scrolling is disabled.

## Do's and Don'ts

### Do:

- **Do** inherit all semantic color, focus, and theme behavior from Hiraya.
- **Do** keep the editor central and preserve one clear active task at narrow widths.
- **Do** use Phosphor icons with visible labels except where compact width requires an accessible icon-only control.
- **Do** preserve keyboard operation, 3px visible focus, 44px primary touch targets, safe areas, reduced motion, and usable reflow at 200% zoom.
- **Do** make dirty, saving, conflict, read-only, failure, and locally published states explicit in words as well as color.

### Don't:

- **Don't** turn the phone layout into a compressed multi-pane IDE or hide primary modes in overflow menus.
- **Don't** hardcode a light or dark app palette, import fonts at runtime, or use accent as general decoration.
- **Don't** introduce card grids, gradients, excessive rounding, or shadows on permanent structure.
- **Don't** add ornamental motion, hover-only affordances, or color-only state communication.
- **Don't** imply server synchronization when the confirmed state is only saved or published locally.
