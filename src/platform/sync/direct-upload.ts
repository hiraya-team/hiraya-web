import type { DirectBlobAccess } from "../../lib/contracts";

export type DirectUploadOptions = {
  signal?: AbortSignal;
  onProgress?: (transferredBytes: number) => void;
  createRequest?: () => XMLHttpRequest;
};

/** Uploads direct blob. */
export function uploadDirectBlob(access: DirectBlobAccess, content: Blob, options: DirectUploadOptions = {}) {
  return new Promise<void>((resolve, reject) => {
    const request = options.createRequest?.() ?? new XMLHttpRequest();
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", abort);
      request.upload.onprogress = null;
      request.onload = null;
      request.onerror = null;
      request.onabort = null;
      operation();
    };
    const abort = () => finish(() => {
      request.abort();
      reject(new DOMException("File upload was stopped.", "AbortError"));
    });

    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    request.open(access.method, access.url, true);
    request.withCredentials = false;
    for (const [name, value] of Object.entries(access.headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => options.onProgress?.(Math.min(content.size, Math.max(0, event.loaded)));
    request.onload = () => {
      if (request.responseURL && new URL(request.responseURL).href !== new URL(access.url).href) {
        finish(() => reject(new Error("Direct file upload was redirected.")));
        return;
      }
      if (request.status >= 200 && request.status < 300) {
        options.onProgress?.(content.size);
        finish(resolve);
      } else {
        finish(() => reject(new Error(`Direct file upload failed (${request.status}).`)));
      }
    };
    request.onerror = () => finish(() => reject(new Error("Direct file upload failed.")));
    request.onabort = () => finish(() => reject(new DOMException("File upload was stopped.", "AbortError")));
    if (options.signal?.aborted) {
      abort();
      return;
    }
    request.send(content);
  });
}
