type AnimationHost = Pick<Element, "getAnimations">;

export function waitForAnimations(hosts: readonly AnimationHost[], onComplete: () => void) {
  let active = true;
  const observed = new Set<Animation>();
  const waitForCurrentAnimations = () => {
    const current = new Set<Animation>();
    for (const host of hosts) {
      for (const animation of host.getAnimations()) {
        if (!observed.has(animation)) current.add(animation);
      }
    }
    if (current.size === 0) {
      onComplete();
      return;
    }
    for (const animation of current) observed.add(animation);
    void Promise.allSettled([...current].map((animation) => animation.finished)).then(() => {
      if (active) waitForCurrentAnimations();
    });
  };
  waitForCurrentAnimations();
  return () => {
    active = false;
  };
}
