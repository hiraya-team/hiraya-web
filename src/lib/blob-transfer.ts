import { md5 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Uploads blob digests. */
export async function uploadBlobDigests(blob: Blob, onProgress?: (hashedBytes: number) => void, signal?: AbortSignal) {
  const sha256Digest = sha256.create();
  const md5Digest = md5.create();
  const reader = blob.stream().getReader();
  let hashedBytes = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      sha256Digest.update(value);
      md5Digest.update(value);
      hashedBytes += value.byteLength;
      onProgress?.(hashedBytes);
    }
  } finally {
    reader.releaseLock();
  }
  return { sha256: bytesToHex(sha256Digest.digest()), md5: bytesToHex(md5Digest.digest()) };
}

/** Reads a response body as a blob while reporting progress. */
export async function responseBlobWithProgress(response: Response, expectedSize: number, onProgress: (transferredBytes: number) => void) {
  if (!response.body) {
    const blob = await response.blob();
    onProgress(blob.size);
    return { blob, sha256: await sha256Blob(blob) };
  }
  const chunks: Uint8Array[] = [];
  const digest = sha256.create();
  const reader = response.body.getReader();
  let transferredBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = new Uint8Array(value);
      chunks.push(chunk);
      transferredBytes += chunk.byteLength;
      if (transferredBytes > expectedSize) throw new Error("The downloaded file is larger than expected.");
      digest.update(chunk);
      onProgress(transferredBytes);
    }
  } finally {
    reader.releaseLock();
  }
  return { blob: new Blob(chunks, { type: response.headers.get("Content-Type") ?? "" }), sha256: bytesToHex(digest.digest()) };
}

/** Returns the SHA-256 digest of a blob. */
export async function sha256Blob(blob: Blob) {
  const digest = sha256.create();
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      digest.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  return bytesToHex(digest.digest());
}

/** Maps with concurrency. */
export async function mapWithConcurrency<T, R>(values: readonly T[], concurrency: number, operation: (value: T) => Promise<R>): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("Blob transfer concurrency must be positive.");
  const results = new Array<R>(values.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const current = index++;
      if (current >= values.length) return;
      results[current] = await operation(values[current]);
    }
  });
  const settled = await Promise.allSettled(workers);
  const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
  return results;
}
