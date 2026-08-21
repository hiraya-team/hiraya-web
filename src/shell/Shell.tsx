import { useCallback, useEffect, useState, type ComponentType } from "react";
import type { PublicAuthority } from "../lib/publication-alias";
import type { DesktopStart, ShellStartup } from "./startup";
import "./shell.css";

type ShellState = { kind: "loading" } | ShellStartup | { kind: "authentication-required" } | { kind: "error"; message: string };
type RichDesktop = ComponentType<DesktopStart>;
type PublicDesktop = ComponentType<{ authority: PublicAuthority }>;

/** Renders the startup interface. */
function Startup() {
  return <main className="startup-state" role="status"><img src={`${import.meta.env.BASE_URL}hiraya-icon.svg`} alt="" /><div><strong>Hiraya</strong><span>Opening desktop...</span></div></main>;
}

/** Renders the shell interface. */
export default function Shell() {
  const [state, setState] = useState<ShellState>({ kind: "loading" });
  const [richDesktop, setRichDesktop] = useState<RichDesktop | null>(null);
  const [publicDesktop, setPublicDesktop] = useState<PublicDesktop | null>(null);

  const requestRich = useCallback(() => {
    void import("./rich").then(({ loadRichDesktop }) => loadRichDesktop()).then((Desktop) => setRichDesktop(() => Desktop)).catch((reason: unknown) => setState({ kind: "error", message: reason instanceof Error ? reason.message : String(reason) }));
  }, []);

  useEffect(() => {
    let active = true;
    void import("./startup").then(({ startShell }) => startShell()).then((next) => {
      if (!active) return;
      setState(next);
      if (next.kind === "public") void import("../PublicDesktop").then(({ default: Desktop }) => { if (active) setPublicDesktop(() => Desktop); });
      else requestRich();
    }).catch((error: unknown) => {
      if (!active) return;
      if (error instanceof Error && error.name === "AuthenticationRequiredError") setState({ kind: "authentication-required" });
      else setState({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    });
    return () => { active = false; };
  }, [requestRich]);

  if (state.kind === "loading" || state.kind === "authentication-required") return <Startup />;
  if (state.kind === "error") return <main className="startup-error"><h1>Hiraya could not start</h1><p>{state.message}</p><button className="button button--primary" type="button" onClick={() => window.location.reload()}>Reload Hiraya</button></main>;
  if (state.kind === "public") {
    const Desktop = publicDesktop;
    return Desktop ? <Desktop authority={state.authority} /> : <Startup />;
  }
  if (!richDesktop) return <Startup />;
  const Desktop = richDesktop;
  return <Desktop {...state.start} />;
}
