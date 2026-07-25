import type { ReactNode } from "react";
import { Desktop } from "@phosphor-icons/react";

export type DesktopTaskbarItem = {
  id: string;
  title: string;
  areaLabel: string;
  icon: ReactNode;
  active: boolean;
  minimized: boolean;
  dirty: boolean;
  otherArea: boolean;
};

type Props = {
  items: readonly DesktopTaskbarItem[];
  onShowDesktop: () => void;
  onActivate: (id: string) => void;
};

export function DesktopTaskbar({ items, onShowDesktop, onActivate }: Props) {
  return <nav className="taskbar" aria-label="Open windows">
    <button className="taskbar__desktop" type="button" aria-label="Show desktop" title="Show desktop" onClick={onShowDesktop}>
      <Desktop size={17} weight="duotone" aria-hidden="true" />
    </button>
    <div className="taskbar__windows">
      {items.map((item) => <button
        className="taskbar__entry"
        type="button"
        key={item.id}
        title={`${item.title} · ${item.areaLabel}`}
        aria-label={`${item.active ? "Minimize" : "Open"} ${item.title}, ${item.areaLabel}`}
        aria-pressed={item.active}
        data-active={item.active || undefined}
        data-minimized={item.minimized || undefined}
        data-dirty={item.dirty || undefined}
        data-other-area={item.otherArea || undefined}
        onClick={() => onActivate(item.id)}
      >
        {item.icon}
        <span>{item.title}</span>
      </button>)}
    </div>
  </nav>;
}
