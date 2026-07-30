import { HirayaBadge } from "./badge";
import { HirayaButton } from "./button";
import { HirayaConfirmDialog, HirayaDialog } from "./dialog";
import { HirayaEmptyState, HirayaPanel, HirayaStatusBar, HirayaToolbar } from "./layout";
import { HirayaNotice } from "./notice";
import { defineElement } from "./shared";

export function defineHirayaPrimitives(): void {
  defineElement("hiraya-button", HirayaButton);
  defineElement("hiraya-badge", HirayaBadge);
  defineElement("hiraya-toolbar", HirayaToolbar);
  defineElement("hiraya-panel", HirayaPanel);
  defineElement("hiraya-status-bar", HirayaStatusBar);
  defineElement("hiraya-empty-state", HirayaEmptyState);
  defineElement("hiraya-notice", HirayaNotice);
  defineElement("hiraya-dialog", HirayaDialog);
  defineElement("hiraya-confirm-dialog", HirayaConfirmDialog);
}
