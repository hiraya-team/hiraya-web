import { expect, test } from "bun:test";

type Evidence = { suite: string; test: string };
type AutomatedAcceptance = { state: "automated"; evidence: Evidence[] };
type GapAcceptance = { state: "gap"; targetGate: string };
type Inventory = {
  schemaVersion: number;
  baseline: { webCommit: string; description: string };
  gates: Array<{ id: string; command: string }>;
  suites: Array<{ id: string; gate: string; file: string }>;
  capabilities: Array<{
    id: string;
    name: string;
    owners: string[];
    activationCritical: boolean;
    acceptance: AutomatedAcceptance | GapAcceptance;
  }>;
};

const inventory = await Bun.file(new URL("../docs/feature-parity.json", import.meta.url)).json() as Inventory;

function unique(values: string[], label: string) {
  expect(new Set(values).size, `${label} must be unique`).toBe(values.length);
}

test("feature parity inventory owns every browser journey and records every gap", async () => {
  expect(inventory.schemaVersion).toBe(1);
  expect(inventory.baseline.webCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(inventory.baseline.description.trim()).not.toBe("");

  unique(inventory.gates.map(({ id }) => id), "gate IDs");
  unique(inventory.suites.map(({ id }) => id), "suite IDs");
  unique(inventory.capabilities.map(({ id }) => id), "capability IDs");

  const gateIds = new Set(inventory.gates.map(({ id }) => id));
  const suites = new Map(inventory.suites.map((suite) => [suite.id, suite]));
  const available = new Set<string>();
  for (const suite of inventory.suites) {
    expect(gateIds.has(suite.gate), `unknown gate ${suite.gate}`).toBe(true);
    const source = await Bun.file(new URL(`../${suite.file}`, import.meta.url)).text();
    const titles = [...source.matchAll(/^\s*test\("([^"]+)"/gm)].map((match) => match[1]!);
    expect(titles.length, `${suite.file} has no tests`).toBeGreaterThan(0);
    unique(titles, `test titles in ${suite.file}`);
    for (const title of titles) available.add(`${suite.id}\0${title}`);
  }

  const represented = new Set<string>();
  const allowedOwners = new Set(["web", "server", "platform"]);
  for (const capability of inventory.capabilities) {
    expect(capability.id).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
    expect(capability.name.trim()).not.toBe("");
    expect(capability.owners.length).toBeGreaterThan(0);
    expect(capability.owners.every((owner) => allowedOwners.has(owner))).toBe(true);
    expect(capability.activationCritical).toBe(true);
    if (capability.acceptance.state === "gap") {
      expect(gateIds.has(capability.acceptance.targetGate), `unknown target gate for ${capability.id}`).toBe(true);
      continue;
    }
    expect(capability.acceptance.evidence.length).toBeGreaterThan(0);
    for (const evidence of capability.acceptance.evidence) {
      expect(suites.has(evidence.suite), `unknown suite ${evidence.suite}`).toBe(true);
      const key = `${evidence.suite}\0${evidence.test}`;
      expect(available.has(key), `missing evidence ${evidence.suite}: ${evidence.test}`).toBe(true);
      represented.add(key);
    }
  }

  expect([...available].filter((key) => !represented.has(key)), "unowned Playwright tests").toEqual([]);
  expect(inventory.capabilities.some(({ acceptance }) => acceptance.state === "gap"), "Phase 0 must expose acceptance gaps").toBe(true);
});
