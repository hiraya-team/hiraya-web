import { useCallback, useEffect, useRef, useState } from "react";
import { Play, WarningCircle } from "@phosphor-icons/react";
import { terminateSandboxNavigation } from "@hiraya/app-runtime/navigation";
import type { SandboxPointerObservation } from "@hiraya/app-runtime/navigation";
import type { FileEntry } from "../../types";
import type { WallpaperSceneTarget } from "../../ui/wallpaper-pointer";
import { useStableHandler } from "../../ui/use-stable-handler";
import { inspectSceneFile, materializeScene, sceneMotionBlocked, SCENE_CSP } from "./scene-package";

type Props = { file: FileEntry | null; contentRevision: number; readContent: (file: FileEntry) => Promise<Blob>; mode: "widget" | "wallpaper"; onPointerObservation?: (observation: SandboxPointerObservation, frame: HTMLIFrameElement) => void; onWallpaperTarget?: (target: WallpaperSceneTarget | null) => void };
type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; html: string; navigationToken: string; revoke(): void };

export function SceneFrame({ file, contentRevision, readContent, mode, onPointerObservation, onWallpaperTarget }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [ready, setReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [allowed, setAllowed] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const loadContent = useStableHandler(readContent);
  const blocked = sceneMotionBlocked(reducedMotion, mode, allowed);

  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setReady(false);
    setState({ status: "loading" });
    if (blocked) return;
    if (!file) { setState({ status: "error", message: "The linked Scene file is no longer available." }); return; }
    let disposed = false;
    let resource: Extract<State, { status: "ready" }> | null = null;
    void loadContent(file).then(async (blob) => {
      const inspection = await inspectSceneFile(new File([blob], file.name, { type: file.mimeType, lastModified: file.modifiedAt }));
      const scene = materializeScene(inspection);
      resource = { status: "ready", html: scene.html, navigationToken: scene.navigationToken, revoke: scene.revoke };
      if (disposed) scene.revoke(); else setState(resource);
    }).catch((reason) => { if (!disposed) setState({ status: "error", message: reason instanceof Error ? reason.message : "The Scene could not be loaded." }); });
    return () => { disposed = true; resource?.revoke(); };
  }, [blocked, contentRevision, file, loadContent]);

  const fail = useCallback(() => setState((current) => {
    if (current.status === "ready") current.revoke();
    return { status: "error", message: "The Scene stopped unexpectedly. Check the package in Integrated Editor." };
  }), []);
  useEffect(() => {
    if (state.status !== "ready") return;
    const frame = frameRef.current;
    if (!frame) return;
    frame.setAttribute("csp", SCENE_CSP);
    if (mode === "wallpaper") onWallpaperTarget?.({ frame, token: state.navigationToken });
    const stop = terminateSandboxNavigation(frame, state.navigationToken, { onNavigation: fail, onPointer: onPointerObservation ? (observation) => onPointerObservation(observation, frame) : undefined, onReady: () => setReady(true) });
    frame.srcdoc = state.html;
    return () => { if (mode === "wallpaper") onWallpaperTarget?.(null); stop(); frame.removeAttribute("srcdoc"); };
  }, [fail, mode, onPointerObservation, onWallpaperTarget, state]);

  if (blocked) return mode === "wallpaper" ? null : <div className="scene-state scene-state--gate"><Play size={20} /><strong>Motion is reduced</strong><span>Run this Scene once when you are ready.</span><button type="button" onClick={() => setAllowed(true)}>Run Scene</button></div>;
  if (state.status === "loading") return <div className="scene-state" role="status">Loading Scene...</div>;
  if (state.status === "error") return <div className="scene-state scene-state--error" role="alert"><WarningCircle size={20} /><span>{state.message}</span></div>;
  return <iframe ref={frameRef} className={`scene-frame scene-frame--${mode}`} data-ready={ready || undefined} title={`${file?.name ?? "Scene"} ${mode}`} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="" tabIndex={mode === "wallpaper" ? -1 : 0} onError={fail} />;
}
