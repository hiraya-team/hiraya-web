import { Check, Desktop, PushPin } from "@phosphor-icons/react";
import type { DesktopIdentity } from "../types";

type Props = {
  desktops: readonly DesktopIdentity[];
  activeDesktopId: string;
  onSwitch: (id: string) => void;
};

export function DesktopSwitcher({ desktops, activeDesktopId, onSwitch }: Props) {
  return <aside id="desktop-switcher" className="desktop-switcher__picker" aria-label="Desktops" popover="auto">
      <header className="desktop-switcher__rail-header">Desktops</header>
      <div className="desktop-switcher__list">
        {desktops.map((desktop) => <button className="desktop-switcher__row desktop-switcher__row--switch" type="button" key={desktop.id} data-active={desktop.id === activeDesktopId || undefined} data-desktop-switch-target aria-current={desktop.id === activeDesktopId ? "true" : undefined} onClick={(event) => { event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover(); onSwitch(desktop.id); }}>
          <Desktop size={18} weight="duotone" /><span><strong>{desktop.name}</strong>{desktop.ownership === "shared" && <small>{desktop.owner.displayName} · {desktop.role}</small>}</span>{desktop.pinned ? <PushPin size={15} weight="fill" aria-label="Pinned" /> : desktop.id === activeDesktopId ? <Check size={15} /> : null}
        </button>)}
       </div>
  </aside>;
}
