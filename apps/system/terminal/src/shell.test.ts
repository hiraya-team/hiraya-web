import { describe, expect, test } from "bun:test";
import { HirayaShell, type ShellEntry, type ShellHost } from "./shell";

class MemoryHost implements ShellHost {
  entries = new Map<string, { kind: "file" | "folder"; text: string }>([["/", { kind: "folder", text: "" }], ["/docs", { kind: "folder", text: "" }], ["/docs/readme.txt", { kind: "file", text: "beta\nalpha\nbeta\n" }]]);
  opened = "";
  async list(path: string) { this.require(path, "folder"); return [...this.entries].filter(([candidate]) => candidate !== path && candidate.slice(0, candidate.lastIndexOf("/")).replace(/^$/, "/") === path).map(([candidate, value]) => this.entry(candidate, value)); }
  async stat(path: string) { const value = this.require(path); return this.entry(path, value); }
  async read(path: string) { return this.require(path, "file").text; }
  async write(path: string, text: string, append: boolean) { const current = this.entries.get(path); this.entries.set(path, { kind: "file", text: append ? (current?.text ?? "") + text : text }); }
  async touch(path: string) { this.entries.set(path, { kind: "file", text: this.entries.get(path)?.text ?? "" }); }
  async mkdir(path: string) { this.entries.set(path, { kind: "folder", text: "" }); }
  async copy(source: string, destination: string) { this.entries.set(destination, { ...this.require(source) }); }
  async move(source: string, destination: string) { this.entries.set(destination, this.require(source)); this.entries.delete(source); }
  async remove(path: string) { this.entries.delete(path); }
  async open(path: string) { this.require(path); this.opened = path; }
  async import() {}
  private require(path: string, kind?: "file" | "folder") { const value = this.entries.get(path); if (!value || kind && value.kind !== kind) throw new Error(`${path}: not found`); return value; }
  private entry(path: string, value: { kind: "file" | "folder"; text: string }): ShellEntry { return { path, name: path.split("/").at(-1) || "/", kind: value.kind, size: value.text.length, modifiedAt: 0 }; }
}

async function run(shell: HirayaShell, command: string) {
  const output: string[] = [];
  const status = await shell.run(command, (text, tone) => output.push(`${tone ?? "output"}:${text}`));
  return { status, output: output.join("\n") };
}

describe("HirayaShell", () => {
  test("navigates, pipes text, expands variables, and redirects output", async () => {
    const host = new MemoryHost();
    const shell = new HirayaShell(host);
    expect((await run(shell, "cd docs; pwd")).output).toContain("output:/docs");
    expect((await run(shell, "cat readme.txt | sort | uniq | wc")).output).toContain("output:2 2 10");
    await run(shell, "NAME=notes; echo $NAME > result.txt");
    expect(await host.read("/docs/result.txt")).toBe("notes\n");
  });

  test("supports aliases, command substitution, conditionals, and status connectors", async () => {
    const host = new MemoryHost();
    const shell = new HirayaShell(host);
    expect((await run(shell, "alias hi='echo hello'; hi $(echo world)")).output).toContain("hello world");
    await host.write("/check.hsh", "if grep alpha /docs/readme.txt; then\n  echo found\nelse\n  echo missing\nfi", false);
    expect((await run(shell, "source /check.hsh")).output).toContain("found");
    expect((await run(shell, "false && echo no || echo yes")).output).toContain("yes");
  });

  test("continues pipelines after nonzero stages and tails newline-terminated text", async () => {
    const shell = new HirayaShell(new MemoryHost());
    expect((await run(shell, "false | echo yes")).output).toContain("yes");
    expect((await run(shell, "tail -n 1 /docs/readme.txt")).output).toContain("beta");
  });

  test("supports nested conditional blocks", async () => {
    const host = new MemoryHost();
    await host.write("/nested.hsh", "if true; then\n  if false; then\n    echo no\n  else\n    echo nested\n  fi\nelse\n  echo no\nfi", false);
    expect((await run(new HirayaShell(host), "source /nested.hsh")).output).toContain("nested");
  });

  test("runs and cancels background jobs", async () => {
    const shell = new HirayaShell(new MemoryHost());
    expect((await run(shell, "sleep 10 &")).output).toContain("[1]");
    expect((await run(shell, "jobs")).output).toContain("running");
    await run(shell, "kill %1");
    await new Promise((resolve) => setTimeout(resolve));
    expect((await run(shell, "jobs")).output).toContain("failed");
  });
});
