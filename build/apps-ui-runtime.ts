import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

const PUBLIC_ID = "virtual:hiraya-apps-ui-runtime";
const RESOLVED_ID = `\0${PUBLIC_ID}`;

interface BunBuildOutput {
  text(): Promise<string>;
}

interface BunBuildResult {
  success: boolean;
  logs: unknown[];
  outputs: BunBuildOutput[];
}

type BunBuild = (options: {
  entrypoints: string[];
  format: "iife";
  minify: boolean;
  target: "browser";
  write: false;
}) => Promise<BunBuildResult>;

export interface CompiledAppsUiRuntime {
  abi: 1;
  script: string;
  styles: string;
}

export async function compileAppsUiRuntime(projectRoot: string): Promise<CompiledAppsUiRuntime> {
  const runtimePath = path.join(projectRoot, "packages", "apps-ui", "src", "runtime.ts");
  const stylesPath = path.join(projectRoot, "packages", "apps-ui", "src", "styles.css");
  const bunModule = "bun";
  const { build } = await import(bunModule) as { build: BunBuild };
  const result = await build({ entrypoints: [runtimePath], format: "iife", minify: true, target: "browser", write: false });
  if (!result.success || result.outputs.length !== 1) {
    throw new Error(`Could not compile the apps UI runtime: ${result.logs.map(String).join("\n")}`);
  }
  return Object.freeze({ abi: 1, script: await result.outputs[0].text(), styles: await readFile(stylesPath, "utf8") });
}

export function appsUiRuntimePlugin(projectRoot: string): Plugin {
  let runtime: CompiledAppsUiRuntime | undefined;
  const runtimePath = path.join(projectRoot, "packages", "apps-ui", "src", "runtime.ts");
  const stylesPath = path.join(projectRoot, "packages", "apps-ui", "src", "styles.css");

  return {
    name: "hiraya-apps-ui-runtime",
    enforce: "pre",
    async buildStart() {
      this.addWatchFile(runtimePath);
      this.addWatchFile(stylesPath);
      runtime = await compileAppsUiRuntime(projectRoot);
    },
    resolveId(id) {
      return id === PUBLIC_ID ? RESOLVED_ID : undefined;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return;
      runtime ??= await compileAppsUiRuntime(projectRoot);
      return `export default Object.freeze(${JSON.stringify(runtime)});`;
    },
  };
}
