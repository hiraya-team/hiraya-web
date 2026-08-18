import { expect, test } from "bun:test";

type Evidence = { suite: string; test: string };
type AutomatedAcceptance = { state: "automated"; evidence: Evidence[] };
type GapAcceptance = { state: "gap"; targetGate: string };
type Inventory = {
  schemaVersion: number;
  baseline: { webCommit: string; description: string };
  gates: Array<{ id: string; command: string }>;
  suites: Array<{ id: string; gate: string; file: string; ownsAllTests?: boolean }>;
  productContractCapabilityIds: string[];
  capabilities: Array<{
    id: string;
    name: string;
    owners: string[];
    activationCritical: boolean;
    acceptance: AutomatedAcceptance | GapAcceptance;
  }>;
};

const PRODUCT_CONTRACT_CAPABILITY_IDS = [
  "workspace.lifecycle",
  "filesystem.import-copy-trash",
  "filesystem.clipboard-file-operations",
  "clipboard.links-and-shortcuts",
  "search.commands-and-results",
  "filesystem.activity",
  "storage.persistence-and-media",
  "shell.windows-keyboard-focus",
  "desktop.spatial-layout",
  "mobile.navigation-gestures-actions",
  "desktop.widgets-groups-themes-scenes",
  "settings.routing-preferences-updates",
  "themes.packages-animated-wallpaper",
  "apps.system-and-file-services",
  "editor.templates",
  "viewers.image-video-fallback",
  "apps.install-sandbox-uninstall",
  "apps.store-and-handlers",
  "apps.data-permissions-associations",
  "sharing.members-invitations",
  "public.desktop-full-surface",
  "publication.items-and-short-links",
  "thumbnails.ffmpeg",
  "packages.seeded-import-export",
  "packages.browser-extension",
  "pwa.install-controlled-update",
  "accessibility.reduced-motion",
  "accessibility.authenticated-zoom-forced-colors",
  "accessibility.tree-live-axe",
  "accessibility.high-contrast",
] as const;

const inventory = await Bun.file(new URL("../docs/feature-parity.json", import.meta.url)).json() as Inventory;

function unique(values: string[], label: string) {
  expect(new Set(values).size, `${label} must be unique`).toBe(values.length);
}

test("feature parity inventory owns every browser journey and rejects acceptance gaps", async () => {
  expect(inventory.schemaVersion).toBe(1);
  expect(inventory.baseline.webCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(inventory.baseline.description.trim()).not.toBe("");

  unique(inventory.gates.map(({ id }) => id), "gate IDs");
  unique(inventory.suites.map(({ id }) => id), "suite IDs");
  unique(inventory.capabilities.map(({ id }) => id), "capability IDs");
  unique(inventory.productContractCapabilityIds, "Product Contract capability IDs");
  expect(inventory.productContractCapabilityIds).toEqual(PRODUCT_CONTRACT_CAPABILITY_IDS);

  const gateIds = new Set(inventory.gates.map(({ id }) => id));
  const suites = new Map(inventory.suites.map((suite) => [suite.id, suite]));
  const available = new Set<string>();
  const fullyOwned = new Set<string>();
  for (const suite of inventory.suites) {
    expect(gateIds.has(suite.gate), `unknown gate ${suite.gate}`).toBe(true);
    const source = await Bun.file(new URL(`../${suite.file}`, import.meta.url)).text();
    const titles = suite.file.endsWith(".go")
      ? [...source.matchAll(/^func (Test[A-Za-z0-9_]+)\(/gm)].map((match) => match[1]!)
      : [...source.matchAll(/^\s*test\("([^"]+)"/gm)].map((match) => match[1]!);
    expect(titles.length, `${suite.file} has no tests`).toBeGreaterThan(0);
    unique(titles, `test titles in ${suite.file}`);
    for (const title of titles) {
      const key = `${suite.id}\0${title}`;
      available.add(key);
      if (suite.ownsAllTests) fullyOwned.add(key);
    }
  }

  const represented = new Set<string>();
  const capabilityById = new Map(inventory.capabilities.map((capability) => [capability.id, capability]));
  for (const id of inventory.productContractCapabilityIds) expect(capabilityById.has(id), `missing Product Contract capability ${id}`).toBe(true);
  const allowedOwners = new Set(["web", "server", "platform"]);
  for (const capability of inventory.capabilities) {
    expect(capability.id).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
    expect(capability.name.trim()).not.toBe("");
    expect(capability.owners.length).toBeGreaterThan(0);
    expect(capability.owners.every((owner) => allowedOwners.has(owner))).toBe(true);
    expect(capability.activationCritical).toBe(true);
    expect(capability.acceptance.state, `${capability.id} remains an acceptance gap`).toBe("automated");
    if (capability.acceptance.state === "gap") {
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

  expect([...fullyOwned].filter((key) => !represented.has(key)), "unowned complete-suite tests").toEqual([]);
  expect(inventory.capabilities.every(({ acceptance }) => acceptance.state === "automated"), "acceptance gaps").toBe(true);
});
