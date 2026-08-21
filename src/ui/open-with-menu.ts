export type OpenWithItem = { id: string; label: string; preferred?: boolean; onOpen: () => void; onSetPreferred?: () => void };

export type OpenWithMenuItem = {
  id: string;
  label: string;
  preferred: boolean;
  meta?: string;
  onSelect: () => void;
  secondaryAction?: { label: string; accessibleLabel: string; onSelect: () => void };
};

/** Builds available application choices for opening a file. */
export function openWithMenuItems(apps: readonly OpenWithItem[]): OpenWithMenuItem[] {
  return apps.map((app) => ({
    id: app.id,
    label: app.label,
    preferred: Boolean(app.preferred),
    meta: app.preferred ? "Default" : undefined,
    onSelect: app.onOpen,
    ...(!app.preferred && app.onSetPreferred ? {
      secondaryAction: {
        label: "Set default",
        accessibleLabel: `Always use ${app.label}`,
        onSelect: app.onSetPreferred,
      },
    } : {}),
  }));
}
