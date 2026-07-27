import { AuthenticationRequiredError, requireAuthenticatedResponse } from "../../lib/auth";
import { parseRevisionConflictDetails } from "../../lib/outbox";

export class SyncRequestError extends Error {
  constructor(message: string, readonly status: number | null, readonly permanent: boolean, readonly code: string | null = null, readonly details: unknown = null) {
    super(message);
  }
}

type SyncHttpClientOptions = {
  fetch: typeof fetch;
  onUnauthorized: () => void;
  onAuthenticationRequired: () => void;
  authenticationPaused: () => boolean;
  onUnavailable: () => void;
};

export class SyncHttpClient {
  constructor(private readonly options: SyncHttpClientOptions) {}

  requireAuthentication(response: Response) {
    if (response.status === 401) this.options.onAuthenticationRequired();
    return requireAuthenticatedResponse(response, this.options.onUnauthorized);
  }

  async requestJson(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
    if (this.options.authenticationPaused()) throw new AuthenticationRequiredError();
    let response: Response;
    try {
      response = await this.options.fetch(input, { credentials: "same-origin", ...init });
    } catch (error) {
      if (init?.signal?.aborted || error instanceof DOMException && error.name === "AbortError") throw new DOMException("Synchronization was stopped.", "AbortError");
      this.options.onUnavailable();
      throw new SyncRequestError("The Hiraya server is unavailable. The change remains queued.", null, false);
    }
    if (init?.signal?.aborted) throw new DOMException("Synchronization was stopped.", "AbortError");
    this.requireAuthentication(response);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string; code?: string; conflict?: unknown } | null;
      const code = typeof body?.code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(body.code) ? body.code : null;
      const details = code === "revision_conflict" ? parseRevisionConflictDetails(body?.conflict) : null;
      throw new SyncRequestError(body?.error || `The Hiraya server rejected the request (${response.status}).`, response.status, response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429, code, details);
    }
    return response.json();
  }
}
