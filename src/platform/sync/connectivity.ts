export type SyncConnectivityHandlers = {
  onOpen: () => void;
  onError: () => void;
  onCatalog: (event: MessageEvent<string>) => void;
  onPoll: () => void;
};

export class SyncConnectivity {
  private events: EventSource | null = null;
  private healthTimer: ReturnType<typeof globalThis.setInterval> | null = null;

  constructor(
    private readonly EventSourceImpl: typeof EventSource | undefined,
    private readonly setIntervalImpl: typeof globalThis.setInterval,
    private readonly clearIntervalImpl: typeof globalThis.clearInterval,
    private readonly eventsUrl: string,
  ) {}

  start(handlers: SyncConnectivityHandlers) {
    this.stop();
    let events: EventSource | null = null;
    try {
      if (this.EventSourceImpl) events = new this.EventSourceImpl(this.eventsUrl);
    } catch {
      events = null;
    }
    this.healthTimer = this.setIntervalImpl(handlers.onPoll, 5_000);
    if (!events) return;
    this.events = events;
    events.onopen = handlers.onOpen;
    events.onerror = handlers.onError;
    events.addEventListener("catalog", (event) => handlers.onCatalog(event as MessageEvent<string>));
  }

  stop() {
    this.events?.close();
    this.events = null;
    if (this.healthTimer !== null) this.clearIntervalImpl(this.healthTimer);
    this.healthTimer = null;
  }
}
