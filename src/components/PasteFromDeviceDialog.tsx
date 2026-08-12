import { useRef } from "react";
import { X } from "@phosphor-icons/react";
import { useNativeDialog } from "../ui/modal-dialog";

export function PasteFromDeviceDialog({ error, onClose }: { error?: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useNativeDialog(dialogRef, onClose);

  return <dialog ref={dialogRef} className="modal-backdrop confirmation-dialog-backdrop" aria-labelledby="device-paste-title" aria-describedby="device-paste-message" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="file-dialog confirmation-dialog">
      <header className="window-header">
        <h2 id="device-paste-title">Paste from device</h2>
        <button className="icon-button" type="button" aria-label="Close paste prompt" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="confirmation-dialog__body">
        <div>
          <p id="device-paste-message">Your browser shares copied files after you press <kbd>Ctrl/⌘ V</kbd>. Keep this prompt open and paste now.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      </div>
      <div className="dialog-actions">
        <button className="button button--quiet" type="button" onClick={onClose}>Cancel</button>
      </div>
    </section>
  </dialog>;
}
