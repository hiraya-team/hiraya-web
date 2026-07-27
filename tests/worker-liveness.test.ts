import { expect, test } from "bun:test";
import { heartbeatDecision } from "../src/platform/storage/worker-liveness";

test("re-probes an owner after scheduler suspension instead of expiring it", () => {
  const probe = { id: 4, checkedAt: 2_000, deadline: 32_000 };
  expect(heartbeatDecision(probe, 32_001, 2_000)).toBe("ping");
});

test("expires an unanswered heartbeat without a scheduler gap", () => {
  const probe = { id: 4, checkedAt: 30_000, deadline: 32_000 };
  expect(heartbeatDecision(probe, 32_000, 2_000)).toBe("expired");
});
