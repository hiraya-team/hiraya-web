import { useCallback, useEffect, useRef, useState } from "react";
import { terminateSandboxNavigation } from "@hiraya/app-runtime/navigation";
import type { CustomTheme, ThemeWallpaperPackage } from "../domain/theme";
import type { ThemePackageCache } from "../lib/theme-package";
import type { WallpaperSceneTarget } from "../ui/wallpaper-pointer";

type Props = { theme: CustomTheme; accessUrl: string; cache?: ThemePackageCache; directBlobOrigin?: string; onWallpaperTarget?: (target: WallpaperSceneTarget | null) => void };
type Loaded = { kind: "image" | "video"; url: string; revoke(): void } | { kind: "scene"; html: string; csp: string; navigationToken: string; revoke(): void };

/** Renders the scene wallpaper interface. */
function SceneWallpaper({ loaded, ready, onReady, onError, onWallpaperTarget }: { loaded: Extract<Loaded, { kind: "scene" }>; ready: boolean; onReady(): void; onError(): void; onWallpaperTarget?: (target: WallpaperSceneTarget | null) => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    onWallpaperTarget?.({ frame, token: loaded.navigationToken });
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
    return () => { onWallpaperTarget?.(null); stopNavigation(); frame.removeAttribute("srcdoc"); };
  }, [loaded, onError, onReady, onWallpaperTarget]);
  return <iframe ref={frameRef} className="wallpaper-scene" data-ready={ready || undefined} title="" aria-hidden="true" inert="" tabIndex={-1} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="" onError={onError} />;
}

/** Renders the theme wallpaper interface. */
export function ThemeWallpaper({ theme, accessUrl, cache, directBlobOrigin, onWallpaperTarget }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const assetId = theme.wallpaper?.assetId;
  const kind = theme.wallpaper?.kind;
  const size = theme.wallpaper?.size;
  const sha256 = theme.wallpaper?.sha256;
  const revision = theme.wallpaper?.revision;
  const motionFallback = reducedMotion && kind !== "static";

  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setReady(false);
    setLoaded(null);
    setFailed(false);
    if (!assetId || !kind || size === undefined || !sha256 || revision === undefined || motionFallback) return;
    const packaged: ThemeWallpaperPackage = { assetId, kind, size, sha256, revision };
    const controller = new AbortController();
    let resource: Loaded | null = null;
    void import("../lib/theme-package").then(async ({ fetchThemePackage, materializeThemeScene, wallpaperAssetBlob, THEME_SCENE_CSP }) => {
      const inspection = await fetchThemePackage(accessUrl, theme.id, packaged, controller.signal, cache, directBlobOrigin);
      if (controller.signal.aborted) return;
      if (packaged.kind === "scene") {
        const scene = materializeThemeScene(inspection);
        resource = { kind: "scene", html: scene.html, csp: THEME_SCENE_CSP, navigationToken: scene.navigationToken, revoke: scene.revoke };
      } else {
        const url = URL.createObjectURL(wallpaperAssetBlob(inspection));
        resource = { kind: inspection.manifest.wallpaper?.entrypoint.match(/\.(?:mp4|webm)$/i) ? "video" : "image", url, revoke: () => URL.revokeObjectURL(url) };
      }
      setLoaded(resource);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); resource?.revoke(); setLoaded(null); };
  }, [accessUrl, assetId, cache, directBlobOrigin, kind, motionFallback, revision, sha256, size, theme.id]);

  const fail = useCallback(() => {
    setReady(false);
    setFailed(true);
    setLoaded((current) => { current?.revoke(); return null; });
  }, []);
  const succeeded = useCallback(() => setReady(true), []);
  return <>
    <div className="wallpaper-image" data-wallpaper-pending={!ready && !failed && !motionFallback || undefined} aria-hidden="true" />
    {loaded?.kind === "scene" && <SceneWallpaper loaded={loaded} ready={ready} onReady={succeeded} onError={fail} onWallpaperTarget={onWallpaperTarget} />}
    {loaded?.kind === "video" && <video className="wallpaper-video" data-ready={ready || undefined} aria-hidden="true" inert="" src={loaded.url} autoPlay loop muted playsInline onCanPlay={succeeded} onError={fail} />}
    {loaded?.kind === "image" && <img className="wallpaper-media" data-ready={ready || undefined} aria-hidden="true" inert="" draggable={false} src={loaded.url} alt="" onLoad={succeeded} onError={fail} />}
  </>;
}
