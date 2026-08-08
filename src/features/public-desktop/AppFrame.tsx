import { TRUSTED_MARKDOWN_CSP, TRUSTED_MARKDOWN_FLAGS } from "@hiraya/app-runtime";
import { SandboxAppFrame } from "@hiraya/app-runtime/react";
import { APPS_UI_RUNTIME } from "../../apps/ui-runtime";
import { SYSTEM_APP_IDS } from "../../apps/system-app-ids";
import type { PublicAppRuntime } from "./app-runtime";

export default function PublicAppFrame({ runtime, onNavigation }: { runtime: PublicAppRuntime; onNavigation: () => void }) {
  return <SandboxAppFrame
    package={runtime.app.package}
    dispatcher={runtime.app.dispatcher}
    title={runtime.app.title}
    uiRuntime={APPS_UI_RUNTIME}
    csp={runtime.app.install.appId === SYSTEM_APP_IDS.markdownPreview ? TRUSTED_MARKDOWN_CSP : undefined}
    sandbox={runtime.app.install.appId === SYSTEM_APP_IDS.markdownPreview ? TRUSTED_MARKDOWN_FLAGS : undefined}
    onNavigation={onNavigation}
  />;
}
