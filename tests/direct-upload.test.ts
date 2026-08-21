import { expect, test } from "bun:test";
import { uploadDirectBlob } from "../src/platform/sync/direct-upload";

/** Builds the fake request test fixture. */
function fakeRequest() {
  const headers: Array<[string, string]> = [];
  const request = {
    method: "",
    url: "",
    body: null as Blob | null,
    status: 200,
    withCredentials: true,
    headers,
    upload: { onprogress: null as ((event: ProgressEvent) => void) | null },
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onabort: null as (() => void) | null,
    open(method: string, url: string) { request.method = method; request.url = url; },
    setRequestHeader(name: string, value: string) { headers.push([name, value]); },
    send(body: Blob) { request.body = body; request.upload.onprogress?.({ loaded: 2 } as ProgressEvent); request.onload?.(); },
    abort() { request.onabort?.(); },
  };
  return request;
}

test("uploads with exact descriptor headers, omitted credentials, and progress", async () => {
  const request = fakeRequest();
  const progress: number[] = [];
  const content = new Blob(["note"]);
  await uploadDirectBlob({ url: "https://uploads.example.test/file?signature=secret", method: "PUT", headers: { "X-Bz-Content-Sha1": "abc", "X-Custom-Case": "value" }, expiresAt: 1 }, content, {
    createRequest: () => request as unknown as XMLHttpRequest,
    onProgress: (bytes) => progress.push(bytes),
  });

  expect(request).toMatchObject({ method: "PUT", url: "https://uploads.example.test/file?signature=secret", body: content, withCredentials: false });
  expect(request.headers).toEqual([["X-Bz-Content-Sha1", "abc"], ["X-Custom-Case", "value"]]);
  expect(progress).toEqual([2, 4]);
});

test("aborts without exposing the presigned URL", async () => {
  const request = fakeRequest();
  request.send = () => undefined;
  const controller = new AbortController();
  const uploading = uploadDirectBlob({ url: "https://uploads.example.test/file?signature=secret", method: "PUT", headers: {}, expiresAt: 1 }, new Blob(["note"]), {
    createRequest: () => request as unknown as XMLHttpRequest,
    signal: controller.signal,
  });
  controller.abort();
  await expect(uploading).rejects.toMatchObject({ name: "AbortError", message: "File upload was stopped." });
});

test("does not send when the signal is already aborted", async () => {
  const request = fakeRequest();
  const controller = new AbortController();
  controller.abort();
  await expect(uploadDirectBlob({ url: "https://uploads.example.test/file?signature=secret", method: "PUT", headers: {}, expiresAt: 1 }, new Blob(["note"]), {
    createRequest: () => request as unknown as XMLHttpRequest,
    signal: controller.signal,
  })).rejects.toMatchObject({ name: "AbortError" });
  expect(request.body).toBeNull();
});

test("rejects a redirected upload response", async () => {
  const request = fakeRequest();
  Object.assign(request, { responseURL: "https://redirected.example.test/file" });
  await expect(uploadDirectBlob({ url: "https://uploads.example.test/file?signature=secret", method: "PUT", headers: {}, expiresAt: 1 }, new Blob(["note"]), {
    createRequest: () => request as unknown as XMLHttpRequest,
  })).rejects.toThrow("was redirected");
});

test("reports a safe status error without exposing the presigned URL", async () => {
  const request = fakeRequest();
  request.status = 503;
  const uploading = uploadDirectBlob({ url: "https://uploads.example.test/file?signature=secret", method: "PUT", headers: {}, expiresAt: 1 }, new Blob(["note"]), {
    createRequest: () => request as unknown as XMLHttpRequest,
  });
  await expect(uploading).rejects.toThrow("Direct file upload failed (503).");
  await expect(uploading).rejects.not.toThrow("signature=secret");
});
