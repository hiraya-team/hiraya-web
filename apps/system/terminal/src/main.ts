import { type AppCapabilities, type HirayaClient, type JsonValue } from "@hiraya-team/apps-sdk";
import { connectSystemApp, describeError, required, setAppLoading } from "@hiraya/system-apps-shared";
import { HirayaShell, type OutputTone, type ShellState } from "./shell";
import { HirayaFileSystem } from "./vfs";
import "./style.css";

type HirayaButton = HTMLElement & { disabled: boolean };
const APP_ID = "app.hiraya.terminal";
const STATE_KEY = "shell-state";
const surface = required<HTMLElement>("#surface");
const terminal = required<HTMLElement>("#terminal");
const transcript = required<HTMLElement>("#transcript");
const prompt = required<HTMLFormElement>("#prompt");
const command = required<HTMLTextAreaElement>("#command");
const promptLabel = required<HTMLLabelElement>("#prompt-label");
const status = required<HTMLElement>("#status");
const loading = required<HTMLElement>("#loading");
const stop = required<HirayaButton>("#stop");
let shell: HirayaShell | null = null;
let hiraya: HirayaClient | null = null;
let active: AbortController | null = null;
let historyIndex = 0;
let saveTimer = 0;

required("#help").addEventListener("click", () => { command.value = "help"; void execute(); });
required("#clear").addEventListener("click", clear);
stop.addEventListener("click", cancel);
prompt.addEventListener("submit", (event) => { event.preventDefault(); void execute(); });
command.addEventListener("input", resizeInput);
command.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void execute(); return; }
  if (event.key === "c" && event.ctrlKey) { if (active) { event.preventDefault(); cancel(); } return; }
  if (event.key === "Tab") { event.preventDefault(); void complete(); return; }
  if (!shell || event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  historyIndex = Math.max(0, Math.min(shell.history.length, historyIndex + (event.key === "ArrowUp" ? -1 : 1)));
  command.value = shell.history[historyIndex] ?? "";
  resizeInput();
});
void start();

async function start() {
  try {
    const app = await connectSystemApp(APP_ID);
    hiraya = app.hiraya;
    const root = app.launch.folders[0];
    if (!root) throw new Error("Terminal requires access to the Hiraya file tree.");
    const stored = parseState(await app.hiraya.storage.get(STATE_KEY));
    const fileSystem = new HirayaFileSystem(app.hiraya, root);
    shell = new HirayaShell(fileSystem, stored);
    app.onDispose(() => { active?.abort(); shell?.dispose(); clearTimeout(saveTimer); });
    app.hiraya.on("capabilities.changed", applyCapabilities);
    app.hiraya.on("commands.invoked", ({ id }) => id === "clear" ? clear() : id === "help" ? (command.value = "help", void execute()) : id === "stop" ? cancel() : undefined);
    await app.hiraya.commands.set([{ id: "help", title: "Show Terminal help" }, { id: "clear", title: "Clear Terminal" }, { id: "stop", title: "Stop foreground command", shortcut: "Ctrl+C", enabled: false }]);
    applyCapabilities(await app.hiraya.app.getCapabilities());
    setAppLoading(surface, terminal, loading);
    for (const id of ["help", "clear"]) required<HirayaButton>(`#${id}`).disabled = false;
    append("Hiraya Terminal 1.0", "accent");
    append("A Unix-like shell for this desktop's files. Type 'help' to list commands.", "muted");
    const launchFile = app.launch.files[0];
    if (launchFile) {
      const path = await fileSystem.pathFor(launchFile);
      const parent = path.slice(0, path.lastIndexOf("/")) || "/";
      await shell.run(`cd ${quote(parent)}`, () => undefined);
      append(`Script ready: ${path}`, "muted");
      command.value = `source ${quote(path)}`;
      resizeInput();
    }
    updatePrompt();
    historyIndex = shell.history.length;
    status.textContent = "Ready. Commands operate only on Hiraya files.";
    command.focus();
  } catch (error) {
    setAppLoading(surface, terminal, loading);
    status.textContent = describeError(error, "Terminal could not start.");
    status.classList.add("error");
  }
}

async function execute() {
  const source = command.value.trim();
  if (!shell || !source || active) return;
  command.value = "";
  resizeInput();
  append(`${shell.cwd} $ ${source}`, "command");
  active = new AbortController();
  stop.disabled = false;
  command.disabled = true;
  status.textContent = "Running...";
  void publishCommands();
  try {
    const code = await shell.run(source, emit, active.signal);
    status.textContent = code === 0 ? "Ready." : `Command exited with status ${code}.`;
  } catch (error) {
    append(describeError(error, "Command failed."), "error");
    status.textContent = "Command failed.";
  } finally {
    active = null;
    stop.disabled = true;
    command.disabled = false;
    historyIndex = shell.history.length;
    updatePrompt();
    scheduleSave();
    command.focus();
    void publishCommands();
  }
}

async function complete() {
  if (!shell || active) return;
  try {
    const matches = await shell.complete(command.value);
    if (matches.length === 1) {
      command.value = command.value.replace(/[^\s|;&<>]*$/, matches[0]);
      resizeInput();
    } else if (matches.length) append(matches.join("  "), "muted");
  } catch (error) { append(describeError(error, "Completion failed."), "error"); }
}

function emit(text: string, tone: OutputTone = "output") {
  if (text === "\u000c") { clear(); return; }
  append(text, tone);
}

function append(text: string, tone: OutputTone | "command" | "accent") {
  if (!text) return;
  const output = document.createElement("pre");
  output.className = `line line--${tone}`;
  output.textContent = text;
  transcript.append(output);
  while (transcript.childElementCount > 1200) transcript.firstElementChild?.remove();
  transcript.scrollTop = transcript.scrollHeight;
}

function clear() {
  transcript.replaceChildren();
  status.textContent = "Terminal cleared.";
  command.focus();
}

function cancel() {
  active?.abort();
}

function updatePrompt() {
  if (!shell) return;
  promptLabel.textContent = `${shell.cwd} $`;
}

function resizeInput() {
  command.style.height = "auto";
  command.style.height = `${Math.min(command.scrollHeight, 112)}px`;
}

function applyCapabilities(capabilities: AppCapabilities) {
  required("#write-state").toggleAttribute("hidden", capabilities.files.write);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (shell) void saveState(shell.state()); }, 250) as unknown as number;
}

async function saveState(state: ShellState) {
  if (!hiraya) return;
  try { await hiraya.storage.set(STATE_KEY, state); }
  catch (error) { status.textContent = describeError(error, "Could not save Terminal settings."); }
}

function publishCommands() {
  return hiraya?.commands.set([{ id: "help", title: "Show Terminal help" }, { id: "clear", title: "Clear Terminal" }, { id: "stop", title: "Stop foreground command", shortcut: "Ctrl+C", enabled: Boolean(active) }]) ?? Promise.resolve();
}

function parseState(value: JsonValue | undefined): Partial<ShellState> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, JsonValue>;
  const history = Array.isArray(record.history) ? record.history.filter((item): item is string => typeof item === "string") : [];
  const aliases = stringRecord(record.aliases);
  const env = stringRecord(record.env);
  return { history, aliases, env };
}

function stringRecord(value: JsonValue | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
