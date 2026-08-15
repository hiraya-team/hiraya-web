import { useRef } from "react";
import { CloudCheck, DownloadSimple, HardDrive, MapTrifold, ShieldWarning, X } from "@phosphor-icons/react";
import { useNativeDialog } from "../ui/modal-dialog";
import type { PwaInstallState } from "../lib/pwa-install";

type Props = { local: boolean; installState: PwaInstallState; onInstall: () => void; onClose: () => void };

export function GettingStartedDialog({ local, installState, onInstall, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useNativeDialog(dialogRef, onClose);
  return <dialog ref={dialogRef} className="modal-backdrop onboarding-backdrop" aria-labelledby="getting-started-title" onWheel={(event) => {
    const dialog = panelRef.current;
    if (!dialog || dialog.scrollHeight <= dialog.clientHeight) return;
    event.preventDefault();
    dialog.scrollBy({ top: event.deltaY });
  }}>
    <section ref={panelRef} className="file-window onboarding-dialog">
      <header className="window-header"><div><span className="window-kicker">Getting started</span><h2 id="getting-started-title">Know where your work lives</h2></div><button className="icon-button" type="button" aria-label="Close Getting Started" onClick={onClose}><X size={18} /></button></header>
      <div className="onboarding-dialog__content">
        <div className="onboarding-dialog__grid">
          <article>{local ? <HardDrive size={22} /> : <CloudCheck size={22} />}<div><h3>{local ? "Saved in this browser" : "Synchronized storage"}</h3><p>{local ? "This browser is authoritative. Clearing site data removes Hiraya files, so download important files before clearing storage." : "The server is authoritative. Cached files and queued changes support offline work; shared desktop editing may require a connection."}</p></div></article>
          <article><ShieldWarning size={22} /><div><h3>Export is not recovery</h3><p>Export creates a deployment seed with no in-product restore path. Synchronized recovery requires a verified operator backup.</p></div></article>
          <article><MapTrifold size={22} /><div><h3>Desktop areas are derived</h3><p>Dragging icons beyond an edge creates another view of one continuous desktop. Areas are derived from positions, not separate folders.</p></div></article>
          <article><DownloadSimple size={22} /><div><h3>Install Hiraya</h3><p>{installState === "standalone" || installState === "installed" ? "Hiraya is installed on this device." : installState === "promptable" ? "Install for an app-like window and quick launch." : "Use your browser's Install app or Add to Home Screen menu when available."}</p>{installState === "promptable" && <button className="button button--quiet" type="button" onClick={onInstall}>Install app</button>}</div></article>
        </div>
        <footer><span>You can revisit this guide from Settings.</span><button className="button button--primary" type="button" autoFocus data-dialog-autofocus onClick={onClose}>Open desktop</button></footer>
      </div>
    </section>
  </dialog>;
}
