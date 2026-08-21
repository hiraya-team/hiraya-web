type TransientDismiss = () => void;

/** Stores transient dismiss actions in activation order. */
const dismissStack: TransientDismiss[] = [];

/** Registers a dismiss action at the top of the transient stack. */
export function registerTransientDismiss(dismiss: TransientDismiss) {
  dismissStack.push(dismiss);
  return () => {
    const index = dismissStack.lastIndexOf(dismiss);
    if (index >= 0) dismissStack.splice(index, 1);
  };
}

/** Dismisses the most recently registered transient surface. */
export function dismissTopTransient() {
  const dismiss = dismissStack.at(-1);
  if (!dismiss) return false;
  dismiss();
  return true;
}
