import { Check, Desktop, PushPin } from "@phosphor-icons/react";
import type { DesktopIdentity } from "../types";
import { ItemList } from "./ItemList";

type Props = {
  desktops: readonly DesktopIdentity[];
  activeDesktopId: string;
  onSwitch: (id: string) => void;
};

export function DesktopSwitcher({ desktops, activeDesktopId, onSwitch }: Props) {
  return <aside id="desktop-switcher" className="desktop-switcher__picker" aria-label="Desktops" popover="auto">
      <header className="desktop-switcher__rail-header">Desktops</header>
      <ItemList items={desktops} getId={(desktop) => desktop.id} label="Desktops" role="listbox" className="desktop-switcher__list" onSelect={(desktop) => { document.getElementById("desktop-switcher")?.hidePopover(); onSwitch(desktop.id); }} renderItem={(desktop, { itemProps }) => <button {...itemProps} className="desktop-switcher__row desktop-switcher__row--switch" type="button" role="option" key={desktop.id} data-active={desktop.id === activeDesktopId || undefined} data-desktop-switch-target aria-selected={desktop.id === activeDesktopId}>
          <Desktop size={18} weight="duotone" /><span><strong>{desktop.name}</strong>{desktop.ownership === "shared" && <small>{desktop.owner.displayName} · {desktop.role}</small>}</span>{desktop.pinned ? <PushPin size={15} weight="fill" aria-label="Pinned" /> : desktop.id === activeDesktopId ? <Check size={15} /> : null}
        </button>} />
  </aside>;
}
