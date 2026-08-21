import { useId, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { useNativeDialog } from "../ui/modal-dialog";

type Props = { title: string; onClose: () => void; children: ReactNode; restoreFocus?: () => HTMLElement | null };

/** Renders the panel dialog interface. */
export function PanelDialog({ title, onClose, children, restoreFocus }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useNativeDialog(dialogRef, onClose, false, restoreFocus);
  return <dialog ref={dialogRef} className="modal-backdrop utility-panel-backdrop" aria-labelledby={titleId} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="file-window utility-panel-dialog">
      <header className="window-header">
        <div><span className="window-kicker">Hiraya</span><h2 id={titleId}>{title}</h2></div>
        <button className="icon-button" type="button" aria-label={`Close ${title}`} onClick={onClose}><X size={18} /></button>
      </header>
      {children}
    </section>
  </dialog>;
}
