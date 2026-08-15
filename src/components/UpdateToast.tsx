import { useId } from "react";
import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import { NotificationCard } from "./NotificationCard";

type Props = {
  applying: boolean;
  blocked: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
};

export function UpdateToast({ applying, blocked, onConfirm, onDismiss }: Props) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <NotificationCard
      badge={blocked ? "Update blocked" : "Update ready"}
      tone={blocked ? "danger" : "progress"}
      icon={blocked ? <WarningCircle size={19} weight="fill" /> : <ArrowClockwise size={19} weight="bold" />}
      role="status"
      ariaLive="polite"
      ariaAtomic
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      dismissLabel="Dismiss update notification"
      dismissDisabled={applying}
      onDismiss={onDismiss}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !applying) {
          event.preventDefault();
          onDismiss();
        }
      }}
      actions={<>
        <button className="notification-action notification-action--primary" type="button" disabled={applying} onClick={onConfirm}>{applying ? "Updating" : blocked ? "Try again" : "Update now"}</button>
        <button className="notification-action" type="button" disabled={applying} onClick={onDismiss}>Later</button>
      </>}
    >
      <strong id={titleId}>{blocked ? "Save changes before updating" : "A new Hiraya version is ready"}</strong>
      <span id={descriptionId}>{blocked ? "An editor has unsaved changes. Save or discard them, then try again." : "Confirm to apply it and reload the desktop."}</span>
    </NotificationCard>
  );
}
