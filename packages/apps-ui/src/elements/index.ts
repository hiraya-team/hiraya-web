import { HirayaBadge } from "./badge";
import { HirayaButton } from "./button";
import { HirayaConfirmDialog, HirayaDialog } from "./dialog";
import { HirayaImageViewer } from "./image-viewer";
import { HirayaEmptyState, HirayaPanel, HirayaStatusBar, HirayaToolbar } from "./layout";
import { HirayaActionSheet, HirayaMenu, HirayaMenuItem, HirayaSubmenu } from "./menu";
import { HirayaNotice } from "./notice";
import { HirayaPopover } from "./popover";
import { HirayaSelectionToolbar } from "./selection-toolbar";
import { defineElement } from "./shared";

export { HirayaBadge } from "./badge";
export { HirayaButton, type HirayaButtonVariant } from "./button";
export { HirayaConfirmDialog, HirayaDialog } from "./dialog";
export { calculateImageFitZoom, clampImageZoom, HirayaImageViewer, type HirayaImageZoom } from "./image-viewer";
export { HirayaEmptyState, HirayaPanel, HirayaStatusBar, HirayaToolbar } from "./layout";
export { HirayaActionSheet, HirayaMenu, HirayaMenuItem, HirayaSubmenu } from "./menu";
export { HirayaNotice } from "./notice";
export { HirayaPopover } from "./popover";
export { HirayaSelectionToolbar } from "./selection-toolbar";

export function defineHirayaElements(): void {
  defineElement("hiraya-button", HirayaButton);
  defineElement("hiraya-badge", HirayaBadge);
  defineElement("hiraya-toolbar", HirayaToolbar);
  defineElement("hiraya-panel", HirayaPanel);
  defineElement("hiraya-status-bar", HirayaStatusBar);
  defineElement("hiraya-empty-state", HirayaEmptyState);
  defineElement("hiraya-notice", HirayaNotice);
  defineElement("hiraya-dialog", HirayaDialog);
  defineElement("hiraya-confirm-dialog", HirayaConfirmDialog);
  defineElement("hiraya-popover", HirayaPopover);
  defineElement("hiraya-menu-item", HirayaMenuItem);
  defineElement("hiraya-menu", HirayaMenu);
  defineElement("hiraya-submenu", HirayaSubmenu);
  defineElement("hiraya-action-sheet", HirayaActionSheet);
  defineElement("hiraya-selection-toolbar", HirayaSelectionToolbar);
  defineElement("hiraya-image-viewer", HirayaImageViewer);
}
