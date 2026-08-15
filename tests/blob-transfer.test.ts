import { expect, test } from "bun:test";
import { mapWithConcurrency, responseBlobWithProgress, uploadBlobDigests } from "../src/lib/blob-transfer";

test("calculates upload SHA-256 and MD5 in one Blob stream pass", async () => {
  const blob = new Blob(["updated note"]);
  const stream = blob.stream.bind(blob);
  let streamReads = 0;
  Object.defineProperty(blob, "stream", { value: () => { streamReads += 1; return stream(); } });

  expect(await uploadBlobDigests(blob)).toEqual({
    sha256: "977eefe2ccc906a187bc83d1815feaa068bbc1268f3d38f368a9bb2197f1a807",
    md5: "e2a4459894e14f0f93cc1c007eae90f8",
  });
  expect(streamReads).toBe(1);
});

test("falls back to Response.blob when a response body stream is unavailable", async () => {
  const response = new Response("note");
  Object.defineProperty(response, "body", { value: null });
  const progress: number[] = [];

  const downloaded = await responseBlobWithProgress(response, 4, (bytes) => progress.push(bytes));
  expect(await downloaded.blob.text()).toBe("note");
  expect(downloaded.sha256).toBe("edb465624291e4053c6c5ea4b7eb320dec773e10a57d26b95dcf0564f8e310f8");
  expect(progress).toEqual([4]);
});

test("reports streamed bytes and rejects oversized downloads", async () => {
  const progress: number[] = [];
  const downloaded = await responseBlobWithProgress(new Response(new Blob(["note"]).stream()), 4, (bytes) => progress.push(bytes));
  expect(await downloaded.blob.text()).toBe("note");
  expect(progress).toEqual([4]);
  await expect(responseBlobWithProgress(new Response(new Blob(["notes"]).stream()), 4, () => undefined)).rejects.toThrow("larger than expected");
});

test("waits for sibling concurrency workers to settle before rejecting", async () => {
  let siblingSettled = false;
  const operation = mapWithConcurrency(["failure", "sibling"], 2, async (value) => {
    if (value === "failure") throw new Error("failed");
    await new Promise((resolve) => setTimeout(resolve, 5));
    siblingSettled = true;
  });
  await expect(operation).rejects.toThrow("failed");
  expect(siblingSettled).toBe(true);
});
