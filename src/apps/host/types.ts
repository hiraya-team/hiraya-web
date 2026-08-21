import type { HirayaErrorCode } from "@hiraya-team/apps-contracts";

export type AppInstanceOwner = Readonly<{
  appId: string;
  instanceId: string;
}>;

/** Represents a host-service failure using the sandbox error contract. */
export class HostServiceError extends Error {
  /** Creates a host error with its public error code. */
  constructor(message: string, public readonly code: HirayaErrorCode) {
    super(message);
    this.name = "HostServiceError";
  }
}

/** Builds the collision-safe key for an owned app instance. */
export function instanceKey(owner: AppInstanceOwner): string {
  return `${owner.appId}\0${owner.instanceId}`;
}

/** Creates the standard error returned after an app instance closes. */
export function unavailable(owner: AppInstanceOwner): HostServiceError {
  return new HostServiceError(`App instance ${owner.instanceId} is closed.`, "UNAVAILABLE");
}

/** Reports whether text contains ASCII control characters. */
export function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}
