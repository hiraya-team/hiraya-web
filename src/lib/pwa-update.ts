export type UpdateCheckResult = "available" | "current" | "unsupported";

export type PwaUpdater = {
  supported: boolean;
  check: () => Promise<UpdateCheckResult>;
  activate: () => Promise<void>;
  dispose: () => void;
};

type Options = {
  onUpdateAvailable: () => void;
  onError: (error: unknown) => void;
};

function waitForInstall(worker: ServiceWorker) {
  if (worker.state === "installed" || worker.state === "redundant") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onStateChange = () => {
      if (worker.state !== "installed" && worker.state !== "redundant") return;
      worker.removeEventListener("statechange", onStateChange);
      resolve();
    };
    worker.addEventListener("statechange", onStateChange);
  });
}

function waitingRegistration(registration: ServiceWorkerRegistration, onUpdateAvailable: () => void) {
  if (!registration.waiting || !navigator.serviceWorker.controller) return false;
  onUpdateAvailable();
  return true;
}

export function createPwaUpdater({ onUpdateAvailable, onError }: Options): PwaUpdater {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
    return {
      supported: false,
      check: async () => "unsupported",
      activate: async () => undefined,
      dispose: () => undefined,
    };
  }

  let registration: ServiceWorkerRegistration | undefined;
  let disposed = false;
  let simulated = false;
  let activating = false;
  const notify = () => { if (!disposed) onUpdateAvailable(); };
  const onMessage = (event: MessageEvent) => {
    if (event.data?.type === "HIRAYA_UPDATE_READY") {
      simulated = import.meta.env.HIRAYA_FRONTEND_ONLY === "true" && event.data.simulated === true;
      notify();
    }
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
  const onControllerChange = () => { if (activating) window.location.reload(); };
  navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, type: "module", updateViaCache: "none" })
    .then((nextRegistration) => {
      if (disposed) return;
      registration = nextRegistration;
      waitingRegistration(nextRegistration, notify);
      const observeInstalling = (installing: ServiceWorker | null) => {
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed") waitingRegistration(nextRegistration, notify);
        });
      };
      observeInstalling(nextRegistration.installing);
      nextRegistration.addEventListener("updatefound", () => observeInstalling(nextRegistration.installing));
    })
    .catch((error) => { if (!disposed) onError(error); });

  return {
    supported: true,
    async check() {
      if (!registration) registration = await navigator.serviceWorker.ready;
      if (waitingRegistration(registration, notify)) return "available";
      await registration.update();
      const installing = registration.installing;
      if (installing) await waitForInstall(installing);
      if (waitingRegistration(registration, notify)) return "available";
      return "current";
    },
    async activate() {
      if (!registration) registration = await navigator.serviceWorker.ready;
      const target = registration.waiting ?? (simulated ? navigator.serviceWorker.controller : null);
      if (!target) throw new Error("The app update is no longer waiting.");
      if (import.meta.env.HIRAYA_FRONTEND_ONLY === "true" && simulated) target.postMessage({ type: "HIRAYA_E2E_ACTIVATE" });
      else {
        activating = true;
        target.postMessage({ type: "HIRAYA_ACTIVATE" });
      }
    },
    dispose() {
      disposed = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    },
  };
}
