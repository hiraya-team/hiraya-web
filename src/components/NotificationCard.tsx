import type { KeyboardEventHandler, ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { StatusBadge, type StatusTone } from "./VisualPrimitives";

type Props = {
  badge: string;
  tone?: StatusTone;
  icon?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  dismissLabel?: string;
  dismissDisabled?: boolean;
  onDismiss?: () => void;
  role?: "alert" | "status";
  ariaLive?: "polite" | "assertive";
  ariaAtomic?: boolean;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
};

export function NotificationCard({ badge, tone = "neutral", icon, children, actions, dismissLabel, dismissDisabled = false, onDismiss, role, ariaLive, ariaAtomic, ariaLabelledBy, ariaDescribedBy, onKeyDown }: Props) {
  return <div className="notification-card" data-tone={tone} role={role} aria-live={ariaLive} aria-atomic={ariaAtomic} aria-labelledby={ariaLabelledBy} aria-describedby={ariaDescribedBy} onKeyDown={onKeyDown}>
    <div className="notification-card__header">
      <StatusBadge tone={tone}>{badge}</StatusBadge>
      {dismissLabel && onDismiss && <button className="notification-dismiss" type="button" disabled={dismissDisabled} aria-label={dismissLabel} onClick={onDismiss}><X size={15} /></button>}
    </div>
    <div className="notification-card__message">
      {icon && <span className="notification-card__icon" aria-hidden="true">{icon}</span>}
      <div>{children}</div>
    </div>
    {actions && <div className="notification-card__actions">{actions}</div>}
  </div>;
}
