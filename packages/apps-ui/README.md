# `@hiraya/apps-ui`

Framework-neutral theme foundations and native web components for sandboxed Hiraya apps.

## Setup

```ts
import { bindTheme } from "@hiraya/apps-ui";
import { defineHirayaPrimitives } from "@hiraya/apps-ui/elements/primitives";
import "@hiraya/apps-ui/styles.css";

defineHirayaPrimitives();
const launch = await hiraya.app.getLaunchContext();
const unsubscribeTheme = bindTheme(hiraya, launch.theme);
```

Add `hiraya-app` to the app's `<body>` to opt into the scoped reset, focus treatment, reduced-motion behavior, and responsive layout utilities. Available classes are `hiraya-stack`, `hiraya-cluster`, `hiraya-cluster--collapse`, `hiraya-panel`, and `hiraya-sr-only`.

Registration is explicit and safe to call more than once:

- `defineHirayaPrimitives()` registers buttons, badges, layout primitives, notices, and dialogs.
- `defineHirayaSystemAppElements()` registers only the small chrome subset used by bundled system apps.
- `defineHirayaImageViewer()` registers the image viewer alone.
- `defineHirayaElements()` registers every component, including interaction components.

Importing an element module does not connect to the Hiraya host. Components consume ordinary attributes, properties, slots, CSS variables, and DOM events.

## Primitives

### `hiraya-button`

Attributes are `variant="secondary|primary|quiet|danger"`, `disabled`, and `loading`. Slots are the default label plus `icon-start` and `icon-end`. The internal native button is exposed as `::part(button)`. This is an action control; use a native `<button type="submit|reset">` when native form submitter identity is required.

### `hiraya-badge`

Use `tone="neutral|accent|danger|progress|readonly"`. Badges are non-interactive and do not create a live region automatically. Slots are the default label and `icon`.

### Layout

- `hiraya-toolbar`: `label`, optional `wrap`, and `leading`, default, and `actions` slots.
- `hiraya-panel`: `header`, default body, and `footer` slots.
- `hiraya-status-bar`: `tone="neutral|accent|danger"` and optional `live="polite|assertive"`.
- `hiraya-empty-state`: `icon`, `title`, default description, and `actions` slots.

### `hiraya-notice`

Attributes are `tone`, `dismissible`, and optional `live`. Slots are `icon`, `title`, default message, and `actions`. Dismissal emits a cancelable, bubbling, composed `hiraya-dismiss` event.

### Dialogs

`hiraya-dialog` supports `open`, `dismiss-disabled`, and `close-label`, with `title`, default body, and `actions` slots. Methods are `showModal()`, `close()`, and `requestClose()`. It emits cancelable `hiraya-request-close` and then `hiraya-close`.

`hiraya-confirm-dialog` accepts `title`, `message`, `confirm-label`, `cancel-label`, `destructive`, `busy`, and `open`. It emits `hiraya-confirm` and `hiraya-cancel`. Use the App SDK's `dialogs.confirm` instead when confirmation belongs to a privileged host operation.

## Interactions

### Popover

`hiraya-popover` uses `trigger` and `content` slots. Use `label` to name its dialog surface. The `open` property is reflected. Methods are `show()`, `hide(reason)`, and `toggle(force)`. `hiraya-open-change` reports `{ open, reason }`.

### Menus

`hiraya-menu` contains `hiraya-menu-item` and `hiraya-submenu` children. Menu items accept `value` and `disabled`, then emit bubbling, composed `hiraya-select` events with `{ value }`. Menus support arrow keys, Home, End, Enter, Space, and Escape.

`hiraya-action-sheet` presents the same item model as a modal mobile sheet. It supports `open` and `label`, emits cancelable `hiraya-request-close`, and reports `hiraya-close`.

### Selection Toolbar

`hiraya-selection-toolbar` accepts `count`, `mode`, and `label`, with `summary` and `actions` slots. Its mode button emits cancelable `hiraya-selection-mode-request` with `{ mode: true }`.

### Image Viewer

```ts
import { defineHirayaImageViewer } from "@hiraya/apps-ui/elements/image-viewer";

defineHirayaImageViewer();
```

`hiraya-image-viewer` accepts `src`, `alt`, `zoom="fit|number"`, `min-zoom`, `max-zoom`, and `rotation`. Methods are `fit()`, `reset()`, `zoomBy(delta)`, and `rotateBy(degrees)`. It supports keyboard and pointer panning, keyboard zoom, and two-pointer pinch zoom.

Events are `hiraya-load`, `hiraya-error`, and `hiraya-zoom-change`. The app owns every object URL assigned to `src` and must revoke it when it is replaced or the app closes.

## Styling

Host theme values are exposed as `--hiraya-*` variables. Components derive control dimensions, spacing, shape, state surfaces, elevation, and motion from optional component variables declared in `styles.css`. Shadow parts are stable customization points; internal class names are not public API.

Apps should preserve readable contrast, visible focus, reduced-motion behavior, and a minimum 44px touch target for important mobile actions. Components do not load fonts or remote assets.
