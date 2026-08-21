/** Creates serial task queue. */
export function createSerialTaskQueue() {
  let sequence = 0;
  let work: Promise<void> = Promise.resolve();

  return {
    run<T>(task: (token: number) => Promise<T>): Promise<T> {
      const token = ++sequence;
      const result = work.then(() => task(token), () => task(token));
      work = result.then(() => undefined, () => undefined);
      return result;
    },
    drain(): Promise<void> {
      return work;
    },
  };
}

/** Creates latest task queue. */
export function createLatestTaskQueue<T>(task: (value: T) => Promise<void>, delay = 0) {
  let pending: { value: T; waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let work: Promise<void> = Promise.resolve();

  const start = () => {
    timer = null;
    const next = pending;
    if (!next) return;
    pending = null;
    work = work.then(() => task(next.value)).then(
      () => { for (const waiter of next.waiters) waiter.resolve(); },
      (error) => { for (const waiter of next.waiters) waiter.reject(error); },
    );
  };

  return {
    run(value: T) {
      const result = new Promise<void>((resolve, reject) => {
        if (pending) {
          pending.value = value;
          pending.waiters.push({ resolve, reject });
        } else {
          pending = { value, waiters: [{ resolve, reject }] };
        }
      });
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(start, delay);
      return result;
    },
    drain(): Promise<void> {
      if (timer !== null) clearTimeout(timer);
      start();
      return work.then<void>(() => {
        if (pending) return this.drain();
      });
    },
  };
}
