import { useRef, useState } from "react";
import { WarningCircle, X } from "@phosphor-icons/react";
import { useNativeDialog } from "../ui/modal-dialog";

export type ConfirmationRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
};

type Props = ConfirmationRequest & {
  onClose: (confirmed: boolean) => void;
};

export function ConfirmationDialog({ title, message, confirmLabel, danger = false, onClose }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useNativeDialog(dialogRef, () => onClose(false), submitting);

  return <dialog ref={dialogRef} className="modal-backdrop confirmation-dialog-backdrop" role="alertdialog" aria-labelledby="confirmation-title" aria-describedby="confirmation-message" onPointerDown={(event) => event.target === event.currentTarget && !submitting && onClose(false)}>
    <section className="file-dialog confirmation-dialog">
      <header className="window-header">
        <div><span className="window-kicker">Confirm action</span><h2 id="confirmation-title">{title}</h2></div>
        <button className="icon-button" type="button" disabled={submitting} aria-label="Close confirmation" onClick={() => onClose(false)}><X size={18} /></button>
      </header>
      <div className="confirmation-dialog__body">
        {danger && <WarningCircle size={24} weight="duotone" aria-hidden="true" />}
        <p id="confirmation-message">{message}</p>
      </div>
      <div className="dialog-actions">
        <button className="button button--quiet" type="button" autoFocus data-dialog-autofocus disabled={submitting} onClick={() => onClose(false)}>Cancel</button>
        <button className={`button ${danger ? "button--danger" : "button--primary"}`} type="button" disabled={submitting} onClick={() => { setSubmitting(true); onClose(true); }}>{confirmLabel}</button>
      </div>
    </section>
  </dialog>;
}
