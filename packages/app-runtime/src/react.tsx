import { useEffect, useRef } from "react";
import type { AppPackageInspection } from "@hiraya/app-cli";
import { RpcDispatcher } from "./dispatcher";
import { initializeSandboxFrame, materializeAppPackage, SANDBOX_CSP, SANDBOX_FLAGS } from "./sandbox";

export function SandboxAppFrame({ package: appPackage, dispatcher, title, onNavigation }: { package: AppPackageInspection; dispatcher: RpcDispatcher; title: string; onNavigation?: () => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const onNavigationRef = useRef(onNavigation);
  onNavigationRef.current = onNavigation;
  useEffect(() => {
    const materialized = materializeAppPackage(appPackage);
    const frame = frameRef.current;
    if (!frame) { materialized.revoke(); return; }
    // Embedded CSP enforcement is experimental, but adds an earlier browser-level check where
    // supported. The srcdoc's meta policy remains authoritative elsewhere.
    frame.setAttribute("csp", SANDBOX_CSP);
    const dispose = initializeSandboxFrame(frame, appPackage.manifest.id, dispatcher, () => onNavigationRef.current?.());
    frame.srcdoc = materialized.html;
    return () => { dispose(); frame.removeAttribute("srcdoc"); materialized.revoke(); };
  }, [appPackage, dispatcher]);
  return <iframe ref={frameRef} className="sandbox-app-frame" title={title} sandbox={SANDBOX_FLAGS} referrerPolicy="no-referrer" allow="" />;
}
