import { useCallback, useEffect, useRef, useState } from "react";
import { terminateSandboxNavigation } from "@hiraya/app-runtime/navigation";
import type { CustomTheme } from "../domain/theme";

type Props = { theme: CustomTheme; accessUrl: string };
type Loaded = { kind: "image" | "video"; url: string; revoke(): void } | { kind: "scene"; html: string; csp: string; navigationToken: string; revoke(): void };

function SceneWallpaper({ loaded, ready, onReady, onError }: { loaded: Extract<Loaded, { kind: "scene" }>; ready: boolean; onReady(): void; onError(): void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    frame.setAttribute("csp", loaded.csp);
    const stopNavigation = terminateSandboxNavigation(frame, loaded.navigationToken, {
      onNavigation: loaded.revoke,
      onReady: () => { if (frame.isConnected) onReady(); },
      replacement: () => {
        const replacement = document.createElement("span");
        replacement.hidden = true;
        replacement.setAttribute("aria-hidden", "true");
        replacement.inert = true;
        return replacement;
      },
    });
    frame.srcdoc = loaded.html;
    return () => { stopNavigation(); frame.removeAttribute("srcdoc"); };
  }, [loaded, onError, onReady]);
  return <iframe ref={frameRef} className="wallpaper-scene" data-ready={ready || undefined} title="" aria-hidden="true" inert tabIndex={-1} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="" onError={onError} />;
}

export function ThemeWallpaper({ theme, accessUrl }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(document.visibilityState !== "hidden");
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const packaged = theme.wallpaper;
    setReady(false);
    setLoaded(null);
    if (!visible || !packaged || reducedMotion && packaged.kind !== "static") return;
    const controller = new AbortController();
    let resource: Loaded | null = null;
    void import("../lib/theme-package").then(async ({ fetchThemePackage, materializeThemeScene, wallpaperAssetBlob, THEME_SCENE_CSP }) => {
      const inspection = await fetchThemePackage(accessUrl, theme.id, packaged, controller.signal);
      if (controller.signal.aborted) return;
      if (packaged.kind === "scene") {
        const scene = materializeThemeScene(inspection);
        resource = { kind: "scene", html: scene.html, csp: THEME_SCENE_CSP, navigationToken: scene.navigationToken, revoke: scene.revoke };
      } else {
        const url = URL.createObjectURL(wallpaperAssetBlob(inspection));
        resource = { kind: inspection.manifest.wallpaper?.entrypoint.match(/\.(?:mp4|webm)$/i) ? "video" : "image", url, revoke: () => URL.revokeObjectURL(url) };
      }
      setLoaded(resource);
    }).catch(() => undefined);
    return () => { controller.abort(); resource?.revoke(); setLoaded(null); };
  }, [accessUrl, reducedMotion, theme, visible]);

  const failed = useCallback(() => {
    setReady(false);
    setLoaded((current) => { current?.revoke(); return null; });
  }, []);
  const succeeded = useCallback(() => setReady(true), []);
  return <>
    <div className="wallpaper-image" aria-hidden="true" />
    {loaded?.kind === "scene" && <SceneWallpaper loaded={loaded} ready={ready} onReady={succeeded} onError={failed} />}
    {loaded?.kind === "video" && <video className="wallpaper-video" data-ready={ready || undefined} aria-hidden="true" inert src={loaded.url} autoPlay loop muted playsInline onCanPlay={succeeded} onError={failed} />}
    {loaded?.kind === "image" && <img className="wallpaper-media" data-ready={ready || undefined} aria-hidden="true" inert draggable={false} src={loaded.url} alt="" onLoad={succeeded} onError={failed} />}
  </>;
}
