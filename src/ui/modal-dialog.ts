import { useEffect, useRef, type RefObject } from "react";
import { registerTransientDismiss } from "./transient-dismiss";

export function useNativeDialog(
  dialogRef: RefObject<HTMLDialogElement | null>,
  onClose: () => void,
  dismissDisabled = false,
  restoreFocus?: () => HTMLElement | null,
  enabled = true,
) {
  const onCloseRef = useRef(onClose);
  const dismissDisabledRef = useRef(dismissDisabled);
  const restoreFocusRef = useRef(restoreFocus);
  const invokerRef = useRef<HTMLElement | null>(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  onCloseRef.current = onClose;
  dismissDisabledRef.current = dismissDisabled;
  restoreFocusRef.current = restoreFocus;
  useEffect(() => {
    if (!enabled) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const invoker = invokerRef.current;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-dialog-autofocus]")?.focus();
    const unregisterDismiss = registerTransientDismiss(() => {
      if (!dismissDisabledRef.current) onCloseRef.current();
    });

    function onCancel(event: Event) {
      event.preventDefault();
      if (!dismissDisabledRef.current) onCloseRef.current();
    }

    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      unregisterDismiss();
      if (dialog.open) dialog.close();
      requestAnimationFrame(() => {
        const target = restoreFocusRef.current?.() ?? invoker;
        if (target?.isConnected) target.focus();
      });
    };
  }, [dialogRef, enabled]);
}
