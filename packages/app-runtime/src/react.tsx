import { useEffect, useRef } from "react";
import type { AppPackageInspection } from "@hiraya-team/apps-contracts";
import { RpcDispatcher } from "./dispatcher";
import { initializeSandboxFrame, materializeAppPackage, SANDBOX_CSP, SANDBOX_FLAGS, type SandboxUiRuntime } from "./sandbox";

/** Renders and manages an application sandbox frame. */
export function SandboxAppFrame({ package: appPackage, dispatcher, title, uiRuntime, onActivate, onNavigation, csp = SANDBOX_CSP, sandbox = SANDBOX_FLAGS }: { package: AppPackageInspection; dispatcher: RpcDispatcher; title: string; uiRuntime: SandboxUiRuntime; onActivate?: () => void; onNavigation?: () => void; csp?: string; sandbox?: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const onActivateRef = useRef(onActivate);
  const onNavigationRef = useRef(onNavigation);
  onActivateRef.current = onActivate;
  onNavigationRef.current = onNavigation;
  useEffect(() => {
    const materialized = materializeAppPackage(appPackage, uiRuntime, URL, csp);
    const frame = frameRef.current;
    if (!frame) { materialized.revoke(); return; }
    // Embedded CSP enforcement is experimental, but adds an earlier browser-level check where
    // supported. The srcdoc's meta policy remains authoritative elsewhere.
    frame.setAttribute("csp", csp);
    const dispose = initializeSandboxFrame(frame, appPackage.manifest.id, dispatcher, materialized.navigationToken, { onActivate: () => onActivateRef.current?.(), onNavigation: () => onNavigationRef.current?.() });
    frame.srcdoc = materialized.html;
    return () => { dispose(); frame.removeAttribute("srcdoc"); materialized.revoke(); };
  }, [appPackage, csp, dispatcher, uiRuntime]);
  return <iframe ref={frameRef} className="sandbox-app-frame" title={title} sandbox={sandbox} referrerPolicy="no-referrer" allow="" />;
}
