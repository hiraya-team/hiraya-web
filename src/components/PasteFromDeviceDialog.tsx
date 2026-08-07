import { useRef } from "react";
import { X } from "@phosphor-icons/react";
import { useModalDialog } from "../ui/modal-dialog";

export function PasteFromDeviceDialog({ error, onClose }: { error?: string; onClose: () => void }) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useModalDialog(backdropRef, dialogRef, onClose);

  return <div ref={backdropRef} className="modal-backdrop confirmation-dialog-backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="file-dialog confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="device-paste-title" aria-describedby="device-paste-message" tabIndex={-1}>
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
  </div>;
}
