export type ShellEntry = { path: string; name: string; kind: "file" | "folder"; size: number; modifiedAt: number; mimeType?: string };

export interface ShellHost {
  list(path: string, signal?: AbortSignal): Promise<ShellEntry[]>;
  stat(path: string, signal?: AbortSignal): Promise<ShellEntry>;
  read(path: string, signal?: AbortSignal): Promise<string>;
  write(path: string, text: string, append: boolean, signal?: AbortSignal): Promise<void>;
  touch(path: string, signal?: AbortSignal): Promise<void>;
  mkdir(path: string, signal?: AbortSignal): Promise<void>;
  copy(source: string, destination: string, recursive: boolean, signal?: AbortSignal): Promise<void>;
  move(source: string, destination: string, signal?: AbortSignal): Promise<void>;
  remove(path: string, recursive: boolean, force: boolean, signal?: AbortSignal): Promise<void>;
  open(path: string, signal?: AbortSignal): Promise<void>;
  import(path: string, folder: boolean, signal?: AbortSignal): Promise<void>;
}

export type ShellState = { history: string[]; aliases: Record<string, string>; env: Record<string, string> };
export type OutputTone = "output" | "error" | "muted";
export type ShellEmitter = (text: string, tone?: OutputTone) => void;

type Job = { id: number; command: string; controller: AbortController; promise: Promise<number>; state: "running" | "done" | "failed"; status?: number };
type CommandResult = { status: number; stdout: string };
type SequenceOperator = ";" | "&&" | "||" | "&";

const COMMANDS = ["alias", "cat", "cd", "clear", "cp", "echo", "edit", "env", "export", "false", "fg", "find", "grep", "head", "help", "history", "import", "jobs", "kill", "ls", "mkdir", "mv", "open", "pwd", "rm", "sleep", "sort", "source", "stat", "tail", "touch", "tree", "true", "unalias", "uniq", "unset", "wc"] as const;
const OPERATORS = new Set([";", "&&", "||", "&", "|", ">", ">>", "<"]);
const MAX_CAPTURE = 1024 * 1024;
const MAX_SCRIPT_DEPTH = 12;
const MAX_WALK_ENTRIES = 10_000;

export class HirayaShell {
  cwd = "/";
  readonly history: string[];
  readonly aliases: Record<string, string>;
  readonly env: Record<string, string>;
  private readonly jobs = new Map<number, Job>();
  private nextJob = 1;
  private lastStatus = 0;

  constructor(private readonly host: ShellHost, state?: Partial<ShellState>) {
    this.history = state?.history?.filter((item) => typeof item === "string").slice(-200) ?? [];
    this.aliases = { ...(state?.aliases ?? {}) };
    this.env = { HOME: "/", PWD: "/", ...(state?.env ?? {}) };
    this.env.PWD = "/";
  }

  state(): ShellState {
    return { history: this.history.slice(-200), aliases: { ...this.aliases }, env: { ...this.env } };
  }

  async run(source: string, emit: ShellEmitter, signal?: AbortSignal): Promise<number> {
    const command = source.trim();
    if (!command) return 0;
    this.history.push(command);
    if (this.history.length > 200) this.history.shift();
    const result = await this.executeText(command, emit, signal, 0);
    this.lastStatus = result;
    return result;
  }

  async complete(source: string, signal?: AbortSignal): Promise<string[]> {
    const match = /(?:^|\s)([^\s|;&<>]*)$/.exec(source);
    const partial = match?.[1] ?? "";
    const prefix = source.slice(0, source.length - partial.length);
    if (!prefix.trim()) return [...new Set([...COMMANDS, ...Object.keys(this.aliases)])].filter((name) => name.startsWith(partial)).sort();
    const slash = partial.lastIndexOf("/");
    const directory = slash >= 0 ? partial.slice(0, slash + 1) : "";
    const needle = slash >= 0 ? partial.slice(slash + 1) : partial;
    const entries = await this.host.list(this.absolute(directory || "."), signal);
    return entries.filter((entry) => entry.name.startsWith(needle)).map((entry) => `${directory}${entry.name}${entry.kind === "folder" ? "/" : ""}`).sort();
  }

  dispose() {
    for (const job of this.jobs.values()) job.controller.abort();
    this.jobs.clear();
  }

  private async executeText(source: string, emit: ShellEmitter, signal: AbortSignal | undefined, depth: number): Promise<number> {
    if (depth > MAX_SCRIPT_DEPTH) throw new Error("Shell nesting limit reached.");
    let status = 0;
    let connector: SequenceOperator = ";";
    for (const part of splitSequence(source)) {
      const shouldRun = connector === ";" || connector === "&" || connector === "&&" && status === 0 || connector === "||" && status !== 0;
      connector = part.operator;
      if (!part.source.trim() || !shouldRun) continue;
      const pipeline = await this.tokenize(part.source, emit, signal, depth);
      if (part.operator === "&") {
        for (const [id, job] of this.jobs) if (job.state !== "running") this.jobs.delete(id);
        if (this.jobs.size >= 64) throw new Error("Too many background jobs.");
        const controller = new AbortController();
        const id = this.nextJob++;
        const command = pipeline.join(" ");
        const job: Job = { id, command, controller, state: "running", promise: Promise.resolve(0) };
        job.promise = this.runPipeline(pipeline, emit, controller.signal, depth).then((result) => {
          if (result.stdout) emit(result.stdout);
          job.status = result.status;
          job.state = result.status === 0 ? "done" : "failed";
          return result.status;
        }).catch((error) => {
          job.status = 130;
          job.state = "failed";
          emit(this.errorMessage(error), "error");
          return 130;
        });
        this.jobs.set(id, job);
        emit(`[${id}] ${command}`, "muted");
        status = 0;
        continue;
      }
      try {
        const result = await this.runPipeline(pipeline, emit, signal, depth);
        status = result.status;
        if (result.stdout) emit(result.stdout);
      } catch (error) {
        status = error instanceof DOMException && error.name === "AbortError" ? 130 : 1;
        emit(this.errorMessage(error), "error");
      }
      this.lastStatus = status;
    }
    return status;
  }

  private async runPipeline(tokens: string[], emit: ShellEmitter, signal: AbortSignal | undefined, depth: number): Promise<CommandResult> {
    const commands: string[][] = [[]];
    for (const token of tokens) {
      if (token === "|") commands.push([]);
      else commands.at(-1)!.push(token);
    }
    if (commands.some((command) => !command.length)) throw new Error("Invalid empty pipeline command.");
    let stdin = "";
    let status = 0;
    for (const command of commands) {
      this.throwIfAborted(signal);
      const result = await this.runCommand(command, stdin, emit, signal, depth);
      stdin = this.cap(result.stdout);
      status = result.status;
    }
    return { status, stdout: stdin };
  }

  private async runCommand(raw: string[], stdin: string, emit: ShellEmitter, signal: AbortSignal | undefined, depth: number): Promise<CommandResult> {
    let tokens = [...raw];
    for (let count = 0; count < 8 && this.aliases[tokens[0]]; count += 1) {
      tokens = [...await this.tokenize(this.aliases[tokens[0]], emit, signal, depth + 1), ...tokens.slice(1)];
    }
    let input = stdin;
    let outputPath = "";
    let append = false;
    const args: string[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === "<" || token === ">" || token === ">>") {
        const path = tokens[++index];
        if (!path || OPERATORS.has(path)) throw new Error(`Missing path after ${token}.`);
        if (token === "<") input = await this.host.read(this.absolute(path), signal);
        else { outputPath = this.absolute(path); append = token === ">>"; }
      } else args.push(token);
    }
    const result = await this.builtin(args, input, emit, signal, depth);
    if (outputPath) {
      await this.host.write(outputPath, result.stdout, append, signal);
      return { ...result, stdout: "" };
    }
    return result;
  }

  private async builtin(args: string[], stdin: string, emit: ShellEmitter, signal: AbortSignal | undefined, depth: number): Promise<CommandResult> {
    const [name, ...rest] = args;
    if (!name) return { status: 0, stdout: stdin };
    const ok = (stdout = ""): CommandResult => ({ status: 0, stdout });
    const lines = (value: string) => value.replace(/\n$/, "").split("\n").filter((line) => line.length);
    switch (name) {
      case "help": return ok(`${COMMANDS.join("  ")}\n\nOperators: |  >  >>  <  &&  ||  ;  &\nScripts: variables, command substitution, aliases, source, and if/then/else/fi blocks.`);
      case "clear": emit("\u000c"); return ok();
      case "pwd": return ok(this.cwd);
      case "cd": {
        const path = this.absolute(rest[0] ?? this.env.HOME ?? "/");
        const entry = await this.host.stat(path, signal);
        if (entry.kind !== "folder") throw new Error(`${rest[0] ?? path}: not a folder`);
        this.cwd = path;
        this.env.PWD = path;
        return ok();
      }
      case "ls": {
        const long = rest.some((arg) => /^-[a-z]*l/.test(arg));
        const path = rest.find((arg) => !arg.startsWith("-")) ?? ".";
        const entries = await this.host.list(this.absolute(path), signal);
        return ok(entries.sort((a, b) => a.name.localeCompare(b.name)).map((entry) => long ? `${entry.kind === "folder" ? "d" : "-"}  ${String(entry.size).padStart(10)}  ${new Date(entry.modifiedAt).toLocaleString()}  ${entry.name}${entry.kind === "folder" ? "/" : ""}` : `${entry.name}${entry.kind === "folder" ? "/" : ""}`).join("\n"));
      }
      case "tree": return ok((await this.walk(this.absolute(rest[0] ?? "."), signal)).map((entry) => `${"  ".repeat(entry.depth)}${entry.item.name}${entry.item.kind === "folder" ? "/" : ""}`).join("\n"));
      case "find": {
        const path = this.absolute(rest[0] && !rest[0].startsWith("-") ? rest[0] : ".");
        const patternIndex = rest.indexOf("-name");
        const pattern = patternIndex >= 0 ? rest[patternIndex + 1] : undefined;
        const matcher = pattern ? new RegExp(`^${pattern.split("*").map(escapeRegex).join(".*")}$`) : null;
        return ok((await this.walk(path, signal)).filter(({ item }) => !matcher || matcher.test(item.name)).map(({ item }) => item.path).join("\n"));
      }
      case "stat": {
        if (!rest.length) throw new Error("stat: missing path");
        const entries = await Promise.all(rest.map((path) => this.host.stat(this.absolute(path), signal)));
        return ok(entries.map((entry) => `${entry.path}\n  type: ${entry.kind}\n  size: ${entry.size}\n  modified: ${new Date(entry.modifiedAt).toISOString()}${entry.mimeType ? `\n  mime: ${entry.mimeType}` : ""}`).join("\n"));
      }
      case "cat": return ok(rest.length ? (await Promise.all(rest.map((path) => this.host.read(this.absolute(path), signal)))).join("") : stdin);
      case "head": case "tail": {
        const countIndex = rest.indexOf("-n");
        const count = countIndex >= 0 ? positiveInteger(rest[countIndex + 1], `${name}: invalid line count`) : 10;
        const paths = countIndex < 0 ? rest : rest.filter((_, index) => index !== countIndex && index !== countIndex + 1);
        const content = paths.length ? (await Promise.all(paths.map((path) => this.host.read(this.absolute(path), signal)))).join("") : stdin;
        const contentLines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
        return ok((name === "head" ? contentLines.slice(0, count) : contentLines.slice(-count)).join("\n"));
      }
      case "echo": return ok(`${rest.join(" ")}\n`);
      case "grep": {
        const insensitive = rest.includes("-i");
        const values = rest.filter((arg) => arg !== "-i");
        const pattern = values.shift();
        if (!pattern) throw new Error("grep: missing pattern");
        const expression = new RegExp(pattern, insensitive ? "i" : "");
        const content = values.length ? (await Promise.all(values.map((path) => this.host.read(this.absolute(path), signal)))).join("") : stdin;
        const matches = lines(content).filter((line) => expression.test(line));
        return { status: matches.length ? 0 : 1, stdout: matches.join("\n") };
      }
      case "sort": return ok(lines(rest.length ? await this.host.read(this.absolute(rest[0]), signal) : stdin).sort((a, b) => a.localeCompare(b)).join("\n"));
      case "uniq": {
        const inputLines = lines(rest.length ? await this.host.read(this.absolute(rest[0]), signal) : stdin);
        return ok(inputLines.filter((line, index) => index === 0 || line !== inputLines[index - 1]).join("\n"));
      }
      case "wc": {
        const content = rest.length ? await this.host.read(this.absolute(rest[0]), signal) : stdin;
        return ok(`${content ? content.split("\n").length - Number(content.endsWith("\n")) : 0} ${content.trim() ? content.trim().split(/\s+/).length : 0} ${new TextEncoder().encode(content).byteLength}`);
      }
      case "touch": if (!rest.length) throw new Error("touch: missing path"); else { for (const path of rest) await this.host.touch(this.absolute(path), signal); return ok(); }
      case "mkdir": if (!rest.length) throw new Error("mkdir: missing path"); else { for (const path of rest.filter((arg) => arg !== "-p")) await this.mkdir(this.absolute(path), rest.includes("-p"), signal); return ok(); }
      case "cp": case "mv": {
        const recursive = rest.includes("-r") || rest.includes("-R");
        const paths = rest.filter((arg) => arg !== "-r" && arg !== "-R");
        if (paths.length !== 2) throw new Error(`${name}: expected source and destination`);
        if (name === "cp") await this.host.copy(this.absolute(paths[0]), this.absolute(paths[1]), recursive, signal);
        else await this.host.move(this.absolute(paths[0]), this.absolute(paths[1]), signal);
        return ok();
      }
      case "rm": {
        const recursive = rest.includes("-r") || rest.includes("-R") || rest.includes("-rf") || rest.includes("-fr");
        const force = rest.includes("-f") || rest.includes("-rf") || rest.includes("-fr");
        const paths = rest.filter((arg) => !arg.startsWith("-"));
        if (!paths.length) throw new Error("rm: missing path");
        for (const path of paths) await this.host.remove(this.absolute(path), recursive, force, signal);
        return ok();
      }
      case "edit": case "open": if (rest.length !== 1) throw new Error(`${name}: expected one path`); else { await this.host.open(this.absolute(rest[0]), signal); return ok(); }
      case "import": await this.host.import(this.absolute(rest.find((arg) => !arg.startsWith("-")) ?? "."), rest.includes("-r") || rest.includes("--folder"), signal); return ok();
      case "history": return ok(this.history.map((item, index) => `${String(index + 1).padStart(4)}  ${item}`).join("\n"));
      case "alias": {
        if (!rest.length) return ok(Object.entries(this.aliases).sort().map(([key, value]) => `alias ${key}='${value.replaceAll("'", "'\\''")}'`).join("\n"));
        for (const assignment of rest) { const [key, value] = splitAssignment(assignment, "alias"); this.aliases[key] = value; }
        return ok();
      }
      case "unalias": for (const key of rest) delete this.aliases[key]; return ok();
      case "export": for (const assignment of rest) { const [key, value] = splitAssignment(assignment, "export"); this.env[key] = value; } return ok();
      case "unset": for (const key of rest) delete this.env[key]; return ok();
      case "env": return ok(Object.entries(this.env).sort().map(([key, value]) => `${key}=${value}`).join("\n"));
      case "source": {
        if (rest.length !== 1) throw new Error("source: expected one script path");
        const script = await this.host.read(this.absolute(rest[0]), signal);
        const output: string[] = [];
        const status = await this.runScript(script, (text, tone) => tone === "error" ? emit(text, tone) : output.push(text), signal, depth + 1);
        return { status, stdout: output.join("\n") };
      }
      case "jobs": return ok([...this.jobs.values()].map((job) => `[${job.id}] ${job.state.padEnd(7)} ${job.command}`).join("\n"));
      case "fg": {
        const job = this.job(rest[0]);
        return { status: await job.promise, stdout: "" };
      }
      case "kill": this.job(rest[0]).controller.abort(); return ok();
      case "sleep": await abortableDelay(Math.round(Number(rest[0] ?? "1") * 1000), signal); return ok();
      case "true": return ok();
      case "false": return { status: 1, stdout: "" };
      default: {
        const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(name);
        if (assignment && !rest.length) { this.env[assignment[1]] = assignment[2]; return ok(); }
        throw new Error(`${name}: command not found`);
      }
    }
  }

  private async runScript(script: string, emit: ShellEmitter, signal: AbortSignal | undefined, depth: number): Promise<number> {
    const lines = script.replaceAll("\r\n", "\n").split("\n");
    let status = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("if ")) {
        const condition = line.replace(/^if\s+/, "").replace(/;?\s*then\s*$/, "");
        if (!/;?\s*then\s*$/.test(line) && lines[++index]?.trim() !== "then") throw new Error("if: expected then");
        const yes: string[] = [];
        const no: string[] = [];
        let branch = yes;
        let nesting = 0;
        while (++index < lines.length) {
          const nestedLine = lines[index].trim();
          if (nestedLine.startsWith("if ")) nesting += 1;
          if (nestedLine === "fi") {
            if (nesting === 0) break;
            nesting -= 1;
          }
          if (nestedLine === "else" && nesting === 0) branch = no;
          else branch.push(lines[index]);
        }
        if (index >= lines.length) throw new Error("if: expected fi");
        const conditionStatus = await this.executeText(condition, () => undefined, signal, depth);
        status = await this.runScript((conditionStatus === 0 ? yes : no).join("\n"), emit, signal, depth);
      } else status = await this.executeText(line, emit, signal, depth);
      if (status === 130) break;
    }
    return status;
  }

  private async walk(path: string, signal: AbortSignal | undefined): Promise<Array<{ item: ShellEntry; depth: number }>> {
    const result: Array<{ item: ShellEntry; depth: number }> = [];
    const visit = async (folder: string, depth: number) => {
      this.throwIfAborted(signal);
      for (const item of await this.host.list(folder, signal)) {
        if (result.length >= MAX_WALK_ENTRIES) throw new Error("Traversal limit reached.");
        result.push({ item, depth });
        if (item.kind === "folder") await visit(item.path, depth + 1);
      }
    };
    await visit(path, 0);
    return result;
  }

  private async mkdir(path: string, parents: boolean, signal: AbortSignal | undefined) {
    if (!parents) { await this.host.mkdir(path, signal); return; }
    let current = "";
    for (const segment of path.split("/").filter(Boolean)) {
      current += `/${segment}`;
      try { await this.host.stat(current, signal); } catch { await this.host.mkdir(current, signal); }
    }
  }

  private job(value: string | undefined) {
    const id = Number(value?.replace(/^%/, "") ?? Math.max(0, ...this.jobs.keys()));
    const job = this.jobs.get(id);
    if (!job) throw new Error(`job not found: ${value ?? "current"}`);
    return job;
  }

  private async tokenize(source: string, emit: ShellEmitter, signal: AbortSignal | undefined, depth: number): Promise<string[]> {
    const tokens: string[] = [];
    let word = "";
    let quote: "'" | "\"" | "" = "";
    const push = () => { if (word) { tokens.push(word); word = ""; } };
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (!quote && character === "#" && !word) {
        while (index < source.length && source[index] !== "\n") index += 1;
        push();
        if (tokens.at(-1) !== ";") tokens.push(";");
        continue;
      }
      if (!quote && (character === " " || character === "\t" || character === "\n")) {
        push();
        if (character === "\n" && tokens.at(-1) !== ";") tokens.push(";");
        continue;
      }
      if (character === "\\" && quote !== "'") { word += source[++index] ?? ""; continue; }
      if (character === "'" || character === "\"") {
        if (!quote) { quote = character; continue; }
        if (quote === character) { quote = ""; continue; }
      }
      if (character === "$" && quote !== "'") {
        if (source[index + 1] === "(") {
          let end = index + 2;
          let nesting = 1;
          for (; end < source.length && nesting; end += 1) { if (source[end] === "(") nesting += 1; else if (source[end] === ")") nesting -= 1; }
          if (nesting) throw new Error("Unclosed command substitution.");
          const output: string[] = [];
          await this.executeText(source.slice(index + 2, end - 1), (text, tone) => tone === "error" ? emit(text, tone) : output.push(text), signal, depth + 1);
          word += output.join("\n").trimEnd();
          index = end - 1;
          continue;
        }
        if (source[index + 1] === "?") { word += String(this.lastStatus); index += 1; continue; }
        const braced = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(source.slice(index));
        const plain = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(source.slice(index));
        const match = braced ?? plain;
        if (match) { word += this.env[match[1]] ?? ""; index += match[0].length - 1; continue; }
      }
      if (!quote) {
        const pair = source.slice(index, index + 2);
        if (["&&", "||", ">>"].includes(pair)) { push(); tokens.push(pair); index += 1; continue; }
        if ([";", "&", "|", ">", "<"].includes(character)) { push(); tokens.push(character); continue; }
      }
      word += character;
    }
    if (quote) throw new Error("Unclosed quote.");
    push();
    while (tokens.at(-1) === ";") tokens.pop();
    return tokens;
  }

  private absolute(path: string): string {
    const parts = (path.startsWith("/") ? path : `${this.cwd}/${path}`).split("/");
    const normalized: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") normalized.pop();
      else normalized.push(part);
    }
    return `/${normalized.join("/")}`;
  }

  private cap(value: string) {
    if (new TextEncoder().encode(value).byteLength > MAX_CAPTURE) throw new Error("Pipeline output exceeded 1 MB.");
    return value;
  }

  private throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Command stopped.", "AbortError");
  }

  private errorMessage(error: unknown) {
    return error instanceof DOMException && error.name === "AbortError" ? "^C" : error instanceof Error ? error.message : "Command failed.";
  }
}

function splitAssignment(value: string, command: string): [string, string] {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(value);
  if (!match) throw new Error(`${command}: expected NAME=value`);
  return [match[1], match[2]];
}

function splitSequence(source: string): Array<{ source: string; operator: SequenceOperator }> {
  const parts: Array<{ source: string; operator: SequenceOperator }> = [];
  let start = 0;
  let quote: "'" | "\"" | "" = "";
  let substitutionDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && quote !== "'") { index += 1; continue; }
    if (character === "'" || character === "\"") {
      if (!quote) quote = character;
      else if (quote === character) quote = "";
      continue;
    }
    if (quote) continue;
    if (character === "$" && source[index + 1] === "(") { substitutionDepth += 1; index += 1; continue; }
    if (character === "(" && substitutionDepth) { substitutionDepth += 1; continue; }
    if (character === ")" && substitutionDepth) { substitutionDepth -= 1; continue; }
    if (substitutionDepth) continue;
    const pair = source.slice(index, index + 2);
    const operator = pair === "&&" || pair === "||" ? pair : character === ";" || character === "&" || character === "\n" ? character === "\n" ? ";" : character : null;
    if (!operator) continue;
    parts.push({ source: source.slice(start, index), operator });
    index += operator.length - 1;
    start = index + 1;
  }
  parts.push({ source: source.slice(start), operator: ";" });
  return parts;
}

function positiveInteger(value: string | undefined, message: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(message);
  return number;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error("sleep: invalid duration");
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);
    const abort = () => { clearTimeout(timer); reject(new DOMException("Command stopped.", "AbortError")); };
    function finish() { signal?.removeEventListener("abort", abort); resolve(); }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
