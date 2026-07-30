import { HirayaButton } from "./button";
import { HirayaEmptyState, HirayaStatusBar, HirayaToolbar } from "./layout";
import { defineElement } from "./shared";

export function defineHirayaSystemAppElements(): void {
  defineElement("hiraya-button", HirayaButton);
  defineElement("hiraya-toolbar", HirayaToolbar);
  defineElement("hiraya-status-bar", HirayaStatusBar);
  defineElement("hiraya-empty-state", HirayaEmptyState);
}
