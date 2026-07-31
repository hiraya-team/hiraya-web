---
name: Hiraya POS
description: A calm, command-first register for selling products and reconciling stock in one portable Hiraya file.
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
    fontSize: "clamp(2.5rem, 12vw, 5.5rem)"
    fontWeight: 700
    lineHeight: 0.92
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(1.65rem, 5vw, 2.5rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.035em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 750
  micro:
    fontSize: "0.68rem"
  badge:
    fontSize: "0.7rem"
  compact:
    fontSize: "0.8rem"
  control:
    fontSize: "0.82rem"
  body-small:
    fontSize: "0.95rem"
  body-large:
    fontSize: "1.05rem"
  action:
    fontSize: "1.08rem"
  title-small:
    fontSize: "1.15rem"
  title:
    fontSize: "1.25rem"
  title-large:
    fontSize: "1.4rem"
  feature-title:
    fontSize: "1.55rem"
  total:
    fontSize: "clamp(1.65rem, 7vw, 2.25rem)"
rounded:
  hint: "0.35rem"
  field: "0.45rem"
  control: "0.5rem"
  navigation: "0.55rem"
  brand: "0.65rem"
  panel: "0.75rem"
  feature: "1rem"
  pill: "99rem"
  circle: "50%"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  2xl: "2rem"
---

# Design System: Hiraya POS

## Creative North Star

**The Command Counter**

Hiraya POS is a working register, not a dashboard or card-grid administration portal. Product lookup and the current sale dominate the selling view; catalog, stock, receipt, and status information are arranged as compact ledger rows around that task.

The identity is calm and repetitive: semantic Hiraya surfaces, precise accent actions, restrained chrome, strong totals, and Phosphor line icons. Permanent structure is flat and bordered. Shadows are reserved for the search command, modal sheets, and welcome mark.

## Colors

The app inherits every color from the Hiraya host. The SDK projects the active light or dark theme onto `--hiraya-*` variables; the app owns no fixed palette.

- **Background:** Deepest work canvas, catalog, table rows, fields, and the create-store side.
- **Surface:** Top bar, checkout, management headings, ledgers, status bar, dialogs, and welcome copy.
- **Elevated Surface:** Secondary controls and mobile navigation.
- **Text:** Active names, prices, totals, quantities, and receipt values.
- **Muted Text:** Descriptions, SKUs, metadata, labels, inactive navigation, and status detail.
- **Border:** One-pixel separators for permanent regions, rows, fields, and control groups.
- **Accent:** Primary actions, active borders and markers, add marks, success marks, and selected-control surfaces. Foreground text and line icons remain on contrast-safe text tokens.
- **Danger:** Read-only warnings, failures, low stock, negative movement, and dangerous status.
- **Focus:** Dedicated keyboard focus treatment, independent of selection.

Preserve semantic roles across themes; never replace them with fixed light, dark, green, amber, or red values.

## Typography

The app uses one native UI sans-serif stack and imports no runtime fonts.

- **Display:** The welcome statement only, tightly tracked and limited to a short measure.
- **Headline:** The selling command question, with responsive scale and a one-line rhythm.
- **Title:** Management and dialog headings.
- **Body:** Product names, prices, forms, receipt content, and explanatory copy.
- **Label:** Compact metadata, field labels, navigation captions, legends, badges, and table headers.
- Numerals receive hierarchy through weight and size rather than a separate typeface.
- Copy remains sentence case; labels do not use decorative uppercase.

## Layout

The main shell fills `100dvh` and keeps body scrolling disabled. It contains a 4rem top bar, flexible workspace, 2.25rem status bar, and responsive navigation.

- **Below 48rem:** Navigation becomes a four-item bottom bar. Checkout appears before the catalog in one scrolling Sell column. Inventory and Sales stack their detail regions.
- **At 48rem and above:** A 5rem left rail replaces the bottom bar. Sell becomes a two-pane counter with a flexible catalog and 21rem-to-24rem checkout.
- **At 48rem and above:** Inventory pairs its table with an 18rem-to-28rem movement ledger; Sales pairs its receipt list with a 20rem-to-28rem detail pane.
- **At 76rem and above:** Generic controls tighten from 2.75rem to 2.5rem, product rows tighten to 4rem, and catalog side padding may expand to 5rem.
- **At 34rem and below:** Open-store text, revision text, read-only badge, and product stock counts hide. Cart lines reflow and Add product becomes icon-only.
- Management tables retain a 44rem minimum width and scroll inside the workspace rather than collapsing columns.
- Safe-area insets protect top-level bars and mobile navigation.

Responsive changes stack or dock the same task surfaces; they do not introduce dashboard summaries or card grids.

## Controls

- **Primary buttons:** Solid accent fill, accent-text foreground, bold label, and restrained corners.
- **Secondary buttons:** Elevated surface, one-pixel border, and the same control geometry.
- **Quiet and icon buttons:** Transparent at rest with a subtle semantic tint on hover.
- **Charge button:** Full-width and 3.5rem high, with action and total aligned to opposite edges.
- **Search command:** A 4rem bordered surface with an ambient shadow, accent icon, clear action, and inset focus treatment.
- **Product and ledger rows:** Full-width and border-separated; names and SKUs lead while stock and money align for scanning.
- **Quantity stepper:** Two 2.75rem square buttons joined around a centered numeric output.
- **Tender selector:** Three equal radio segments with bordered default and accent-tinted checked states.
- **Fields:** Background surface, one-pixel border, visible labels, and native input semantics.
- **Navigation:** Phosphor icon plus short label; active destinations use accent text and a low-opacity accent surface.
- **Dialogs:** Native modal dialogs capped at 30rem, with panel corners, strong shadow, semantic backdrop, and right-aligned actions.

## States

- Disabled controls remain in place with reduced opacity and a not-allowed cursor.
- Read-only access appears as a danger badge when space permits and always produces explicit status text.
- Low stock and negative movement use danger text; positive movement uses accent text.
- Active receipts use an accent tint plus a 3px inset leading marker.
- Successful checkout replaces the form with the immutable receipt and a next-sale action.
- Empty states pair a Phosphor icon well with a short title and corrective guidance.
- The persistent status bar uses an icon, live-announced message, file extension, and revision.
- Busy refresh rotates its icon; submit labels change to Saving or Creating.
- Conflict, offline, permission, quota, stale-cart, and uncertain-save outcomes are explained in text rather than color alone.

## Motion

- The only continuous animation is the 0.85s refresh spinner.
- Hover and selection feedback use immediate color, brightness, or surface changes.
- There are no decorative entrances, page transitions, bouncing controls, or animated layout changes.
- Reduced-motion mode collapses animation and transition durations and disables smooth scrolling.

## Accessibility

- Buttons, fields, fieldsets, labels, table roles, navigation landmarks, headings, status regions, and native dialogs retain explicit semantics.
- Keyboard focus uses a 3px focus-token outline with a 2px offset.
- `Ctrl/Cmd+K` focuses product search, `Ctrl/Cmd+N` starts a sale, and `Ctrl/Cmd+O` opens a store.
- Native modal behavior provides focus containment, Escape dismissal, background inertness, and focus restoration.
- Icon-only actions have accessible labels; decorative icons are hidden from assistive technology.
- Active navigation exposes `aria-current="page"`; status changes use a polite live region.
- Primary operational targets remain at least 2.75rem on touch layouts.

## Do and Don't

- **Do** keep the running receipt, total, tender, completion action, and product search visually primary.
- **Do** inherit color and focus behavior from Hiraya semantic tokens.
- **Do** use compact ledger rows, aligned money, one-pixel dividers, and restrained corners.
- **Do** keep success, danger, read-only, empty, busy, and save outcomes explicit in words.
- **Don't** turn the register into a card-grid dashboard or analytics portal.
- **Don't** hardcode a palette, import fonts, invent imagery, or replace the host theme.
- **Don't** use gradients, ornamental illustration, excessive rounding, or shadows on permanent panes.
- **Don't** communicate state through color, hover, or disabled controls alone.
