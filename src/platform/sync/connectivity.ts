export type SyncConnectivityHandlers = {
  onOpen: () => void;
  onError: () => void;
  onCatalog: (event: MessageEvent<string>) => void;
  onPoll: () => Promise<void> | void;
};

const HEALTH_POLL_MS = 5_000;

export class SyncConnectivity {
  private events: EventSource | null = null;
  private healthTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private healthCheck: Promise<void> | null = null;
  private generation = 0;

  constructor(
    private readonly EventSourceImpl: typeof EventSource | undefined,
    private readonly setTimeoutImpl: typeof globalThis.setTimeout,
    private readonly clearTimeoutImpl: typeof globalThis.clearTimeout,
    private readonly eventsUrl: string,
  ) {}

  start(handlers: SyncConnectivityHandlers) {
    this.stop();
    const generation = this.generation;
    const schedulePoll = () => {
      if (this.generation !== generation) return;
      this.healthTimer = this.setTimeoutImpl(() => {
        this.healthTimer = null;
        void poll();
      }, HEALTH_POLL_MS);
    };
    const poll = () => {
      if (this.generation !== generation) return Promise.resolve();
      if (this.healthTimer !== null) this.clearTimeoutImpl(this.healthTimer);
      this.healthTimer = null;
      if (this.healthCheck) return this.healthCheck;
      const check = Promise.resolve().then(handlers.onPoll).finally(() => {
        if (this.healthCheck === check) this.healthCheck = null;
        schedulePoll();
      });
      this.healthCheck = check;
      return check;
    };
    let events: EventSource | null = null;
    try {
      if (this.EventSourceImpl) events = new this.EventSourceImpl(this.eventsUrl);
    } catch {
      events = null;
    }
    schedulePoll();
    if (!events) return;
    this.events = events;
    events.onopen = () => { if (this.generation === generation) handlers.onOpen(); };
    events.onerror = () => {
      if (this.generation !== generation) return;
      handlers.onError();
      void poll();
    };
    events.addEventListener("catalog", (event) => { if (this.generation === generation) handlers.onCatalog(event as MessageEvent<string>); });
  }

  stop() {
    this.generation += 1;
    this.events?.close();
    this.events = null;
    if (this.healthTimer !== null) this.clearTimeoutImpl(this.healthTimer);
    this.healthTimer = null;
    this.healthCheck = null;
  }
}
