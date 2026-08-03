---
name: Todo
description: A compact Hiraya work ledger for safe, portable task lists.
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
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.5
rounded:
  control: "0.45rem"
  panel: "0.75rem"
  pill: "999px"
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
    padding: "0.4rem 0.85rem"
    height: "2.75rem"
  text-field:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 0.7rem"
    height: "2.75rem"
---

# Design System: Todo

## Overview

**Creative North Star: "The Compact Work Ledger"**

Todo is a calm, direct Hiraya tool, not a dashboard or a priority-column board. One creation strip feeds one flat task ledger, keeping task capture, current scope, and file state visible without ornamental structure. It extends Project Studio's semantic theme, restrained chrome, compact status, and explicit storage language.

**Key Characteristics:**

- Balanced density (5/10), predictable variance (3/10), and restrained motion (3/10).
- One bordered ledger rather than repeated cards or columns.
- Native task controls inside host-coherent Hiraya primitives.
- Explicit saved, dirty, read-only, conflict, and failure states.

## Colors

The host-resolved `--hiraya-*` tokens are authoritative in every theme; Todo never owns a fixed light or dark palette.

### Primary

- **Hiraya Accent:** Marks the primary action, active filter, checkboxes, and dirty state. Accent fills always use the matching accent-text token.

### Tertiary

- **Hiraya Danger:** Reserved for conflicts, failures, overdue dates, and destructive actions.

### Neutral

- **Background:** Deepest canvas and native form-field contrast.
- **Surface:** Permanent toolbar, panel, row, and status structure.
- **Elevated Surface:** Native controls that must separate from their parent.
- **Text and Muted Text:** Task titles use text; dates, counts, and file state use muted text.
- **Border:** One-pixel structural divisions between permanent regions.
- **Focus:** Dedicated high-contrast keyboard focus, independent from accent and danger.

**The Semantic State Rule.** Selection, focus, danger, and elevation retain distinct roles across every host theme.

## Typography

**Display and Body Font:** Native UI sans-serif stack.

**Character:** Familiar desktop typography keeps the app fast and quiet. Hierarchy comes from weight, spacing, and semantic color rather than oversized type.

### Hierarchy

- **Title:** Task names and panel headings use 1rem text at weight 650 with relaxed wrapping.
- **Body:** Ordinary controls and status use 0.875rem text with a 1.5 line height.
- **Label:** Field names and metadata use 0.75rem bold sentence case.

**The Task Owns the Line Rule.** Task titles wrap without truncation; labels and metadata stay compact around them.

## Layout

The shell fills `100dvh` with a host toolbar, scrollable workspace, and persistent status bar. The workspace is centered at a maximum width of 68rem. A compact composer sits above the list; filters and counts share the list heading.

At widths below 50rem, the title field takes its own row. Below 42rem, fields stack, filters become three equal controls, task actions move under task metadata, and the panel footer stacks. The layout must never create horizontal scrolling, and its status bar remains visible while the workspace scrolls.

## Elevation & Depth

Todo is flat by default. One-pixel borders and semantic surface changes define permanent structure. The app adds no shadows; temporary host dialogs own their own elevation.

**The Structure Before Depth Rule.** Permanent task UI uses borders and tonal surfaces, never floating cards or decorative shadow.

## Shapes

Controls use restrained 0.45rem corners and panels use 0.75rem corners inherited from the injected Hiraya runtime. Pills are limited to compact file-state badges. Task rows remain rectilinear and meet at one-pixel dividers.

## Components

### Host Primitives

- Use injected `hiraya-toolbar`, `hiraya-button`, `hiraya-badge`, `hiraya-panel`, `hiraya-notice`, `hiraya-empty-state`, and `hiraya-status-bar` elements for file controls, structure, and explicit states.
- Keep checkbox, date, select, and form submission semantics native.

### Inputs and Buttons

- Native inputs use elevated surface fill, a one-pixel border, 0.45rem corners, and a 3px host focus outline.
- The native submit button matches the host primary action: accent fill, accent text, 2.75rem height, and a one-pixel active translation.
- Disabled actions retain their layout and use reduced opacity plus a non-interactive cursor.

### Task Rows

- Each row places a 44px checkbox target before a wrapping title and metadata, with edit and delete actions at the end.
- Completion uses checkbox state plus line-through text. Priority and overdue state always include words, never color alone.
- Filters use `aria-pressed`; the selected filter adds accent text, semantic selected fill, and bold weight.

### Motion

- Motion is functional only: native button press feedback and short semantic state transitions.
- Under `prefers-reduced-motion`, all transitions and animations collapse to near-zero duration.

## Do's and Don'ts

### Do:

- **Do** inherit every color, focus, and theme role from Hiraya.
- **Do** preserve one clear task ledger at every width.
- **Do** keep file state and conflict recovery visible in words.
- **Do** preserve keyboard save, 44px task controls, reduced motion, and 200% zoom reflow.

### Don't:

- **Don't** add fixed colors, gradients, glow, glass, or decorative shadow.
- **Don't** introduce dashboard metrics, equal-card grids, priority columns, or a kanban metaphor.
- **Don't** use emoji, custom cursors, runtime font imports, or fabricated task content.
- **Don't** overwrite a remote file without an explicit conflict action and confirmation.
