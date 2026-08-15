import { Control } from "./Control";

export type WorkerStatus = "installing" | "ready" | "failed";

export function Shell(props: { unsupported: readonly string[]; workerStatus: () => WorkerStatus }) {
  const ready = () => props.unsupported.length === 0 && props.workerStatus() === "ready";
  const title = () => props.unsupported.length
    ? "This browser cannot open Hiraya yet."
    : props.workerStatus() === "failed" ? "Offline setup needs attention." : props.workerStatus() === "installing" ? "Preparing your offline workspace." : "Your local workspace is ready.";
  const message = () => props.unsupported.length
    ? `Hiraya needs ${props.unsupported.join(", ")} before it can protect local work.`
    : props.workerStatus() === "failed" ? "The offline shell could not be installed. Check this site's browser permissions, then try again."
      : props.workerStatus() === "installing" ? "Hiraya is installing the small shell required for safe offline startup."
        : "The offline shell is installed. Files and synchronization arrive in the next foundation milestones.";
  return (
    <div class="shell">
      <header class="menu-bar">
        <span class="mark" aria-hidden="true">H</span>
        <strong>Hiraya</strong>
        <span class="milestone">Foundation</span>
      </header>
      <main>
        <section class="status-panel" aria-labelledby="status-title">
          <div class="status-symbol" data-ready={ready()} aria-hidden="true"><span /></div>
          <div class="status-copy">
            <h1 id="status-title">{title()}</h1>
            <p role="status">{message()}</p>
          </div>
          <Control disabled={props.unsupported.length === 0 && props.workerStatus() === "installing"} onClick={() => location.reload()}>
            {ready() ? "Reload shell" : props.workerStatus() === "installing" && props.unsupported.length === 0 ? "Installing shell" : "Try again"}
          </Control>
        </section>
      </main>
      <footer>Local-first foundation · No workspace data has been created</footer>
    </div>
  );
}
