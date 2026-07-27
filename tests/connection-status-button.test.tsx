import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionStatusButton } from "../src/features/connection/ConnectionStatusButton";

test("renders computed recovery status for compact mobile chrome", () => {
  const blocked = renderToStaticMarkup(<ConnectionStatusButton status="blocked" syncing={false} outboxRecords={[]} onOpen={() => undefined} />);
  const waiting = renderToStaticMarkup(<ConnectionStatusButton status="online" syncing={false} outboxRecords={[{ status: "pending" } as never]} onOpen={() => undefined} />);
  expect(blocked).toContain("Sync blocked");
  expect(blocked).toContain("resolve queued changes");
  expect(waiting).toContain("Waiting to sync");
  expect(waiting).toContain("recovery options");
});
