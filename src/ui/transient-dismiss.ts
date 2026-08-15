type TransientDismiss = () => void;

const dismissStack: TransientDismiss[] = [];

export function registerTransientDismiss(dismiss: TransientDismiss) {
  dismissStack.push(dismiss);
  return () => {
    const index = dismissStack.lastIndexOf(dismiss);
    if (index >= 0) dismissStack.splice(index, 1);
  };
}

export function dismissTopTransient() {
  const dismiss = dismissStack.at(-1);
  if (!dismiss) return false;
  dismiss();
  return true;
}
