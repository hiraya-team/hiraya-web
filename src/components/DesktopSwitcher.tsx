import { Check, Desktop, PushPin } from "@phosphor-icons/react";
import type { DesktopIdentity } from "../types";

type Props = {
  desktops: readonly DesktopIdentity[];
  activeDesktopId: string;
  onSwitch: (id: string) => void;
  onDismiss: () => void;
};

export function DesktopSwitcher({ desktops, activeDesktopId, onSwitch, onDismiss }: Props) {
  return <aside className="desktop-switcher__rail" aria-label="Desktops" onKeyDown={(event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onDismiss();
  }}>
      <header className="desktop-switcher__rail-header">Desktops</header>
      <div className="desktop-switcher__list" role={desktops.length ? "list" : undefined}>
        {desktops.map((desktop) => <div className="desktop-switcher__row desktop-switcher__row--switch" role="listitem" key={desktop.id} data-active={desktop.id === activeDesktopId || undefined}>
             <button type="button" data-desktop-switch-target aria-current={desktop.id === activeDesktopId ? "true" : undefined} onClick={() => onSwitch(desktop.id)}>
                  <Desktop size={18} weight="duotone" /><span><strong>{desktop.name}</strong>{desktop.ownership === "shared" && <small>{desktop.owner.displayName} · {desktop.role}</small>}</span>{desktop.pinned ? <PushPin size={15} weight="fill" aria-label="Pinned" /> : desktop.id === activeDesktopId ? <Check size={15} /> : null}
             </button>
          </div>)}
       </div>
  </aside>;
}
