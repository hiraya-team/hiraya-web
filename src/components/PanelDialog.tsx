import { useId, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { useModalDialog } from "../ui/modal-dialog";

type Props = { title: string; onClose: () => void; children: ReactNode; restoreFocus?: () => HTMLElement | null };

export function PanelDialog({ title, onClose, children, restoreFocus }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  useModalDialog(backdropRef, dialogRef, onClose, false, restoreFocus);
  return <div ref={backdropRef} className="modal-backdrop utility-panel-backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="file-window utility-panel-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="window-header">
        <div><span className="window-kicker">Hiraya</span><h2 id={titleId}>{title}</h2></div>
        <button className="icon-button" type="button" aria-label={`Close ${title}`} onClick={onClose}><X size={18} /></button>
      </header>
      {children}
    </section>
  </div>;
}
