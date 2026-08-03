import { API_ROUTES } from "./api-routes";
import { assertValidId, isRecord } from "./contracts";

export type SharingRole = "manager" | "writer" | "reader";
export type SharingMember = {
  userId: string;
  displayName: string;
  email?: string;
  avatar: string | null;
  role: "owner" | SharingRole;
};
export type SharingInvitation = {
  id: string;
  email: string;
  role: SharingRole;
  url?: string;
  token?: string;
};
export type PublishedItem = {
  entryId: string;
  alias: string;
  name: string;
  kind: "file" | "folder";
  url: string;
};
export type DesktopPublication = {
  configured: boolean;
  baseUrl: string;
  desktopAlias?: string;
  shareEntire: boolean;
  url?: string;
  items: PublishedItem[];
};
export type DesktopAudience = {
  kind: "authenticated-users";
  role: SharingRole;
};
export type SharingState = {
  members: SharingMember[];
  pending: SharingInvitation[];
  publication: DesktopPublication;
  audience: DesktopAudience | null;
};

function role(value: unknown, allowOwner = false): "owner" | SharingRole {
  if (
    value === "reader" ||
    value === "writer" ||
    value === "manager" ||
    (allowOwner && value === "owner")
  )
    return value;
  throw new Error("Sharing data contains an invalid role.");
}

export function parseSharingState(value: unknown): SharingState {
  if (!isRecord(value))
    throw new Error("The sharing response has an unsupported format.");
  const memberValues = Array.isArray(value.members) ? value.members : [];
  const invitationValues = Array.isArray(value.pending)
    ? value.pending
    : Array.isArray(value.invitations)
      ? value.invitations
      : Array.isArray(value.pendingInvitations)
        ? value.pendingInvitations
        : [];
  const members = memberValues.map((candidate): SharingMember => {
    if (!isRecord(candidate))
      throw new Error("Sharing data contains an invalid member.");
    const userId =
      typeof candidate.userId === "string" ? candidate.userId : candidate.id;
    assertValidId(userId, "Sharing data contains an invalid member ID.");
    if (
      typeof candidate.displayName !== "string" ||
      !candidate.displayName.trim()
    )
      throw new Error("Sharing data contains an invalid member name.");
    return {
      userId,
      displayName: candidate.displayName.trim(),
      ...(typeof candidate.email === "string"
        ? { email: candidate.email }
        : {}),
      avatar: typeof candidate.avatar === "string" ? candidate.avatar : null,
      role: role(candidate.role, true),
    };
  });
  const pending = invitationValues.map((candidate): SharingInvitation => {
    if (!isRecord(candidate) || typeof candidate.email !== "string")
      throw new Error("Sharing data contains an invalid invitation.");
    const id =
      typeof candidate.id === "string"
        ? candidate.id
        : typeof candidate.token === "string"
          ? candidate.token
          : candidate.email;
    return {
      id,
      email: candidate.email,
      role: role(candidate.role) as SharingRole,
      ...(typeof candidate.url === "string" ? { url: candidate.url } : {}),
      ...(typeof candidate.token === "string"
        ? { token: candidate.token }
        : {}),
    };
  });
  const publicationValue = isRecord(value.publication) ? value.publication : {};
  const items = (
    Array.isArray(publicationValue.items) ? publicationValue.items : []
  ).map((candidate): PublishedItem => {
    if (
      !isRecord(candidate) ||
      typeof candidate.entryId !== "string" ||
      typeof candidate.alias !== "string" ||
      typeof candidate.name !== "string" ||
      (candidate.kind !== "file" && candidate.kind !== "folder") ||
      typeof candidate.url !== "string"
    )
      throw new Error("Sharing data contains an invalid published item.");
    return {
      entryId: candidate.entryId,
      alias: candidate.alias,
      name: candidate.name,
      kind: candidate.kind,
      url: candidate.url,
    };
  });
  const audienceValue = value.audience;
  const audience: DesktopAudience | null =
    isRecord(audienceValue) && audienceValue.kind === "authenticated-users"
      ? {
          kind: "authenticated-users",
          role: role(audienceValue.role) as SharingRole,
        }
      : null;
  return {
    members,
    pending,
    publication: {
      configured: publicationValue.configured === true,
      baseUrl:
        typeof publicationValue.baseUrl === "string"
          ? publicationValue.baseUrl
          : "",
      shareEntire: publicationValue.shareEntire === true,
      items,
      ...(typeof publicationValue.desktopAlias === "string"
        ? { desktopAlias: publicationValue.desktopAlias }
        : {}),
      ...(typeof publicationValue.url === "string"
        ? { url: publicationValue.url }
        : {}),
    },
    audience,
  };
}

async function request(input: string, init?: RequestInit) {
  const response = await fetch(input, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      body?.error || `The sharing request failed (${response.status}).`,
    );
  }
  return response.status === 204 ? null : response.json().catch(() => null);
}

const publicationClientId = crypto.randomUUID();
function publicationHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Hiraya-Client-ID": publicationClientId,
    "X-Hiraya-Operation-ID": crypto.randomUUID(),
  };
}

export async function getSharing(desktopId: string) {
  return parseSharingState(await request(API_ROUTES.desktopSharing(desktopId)));
}
export async function inviteMember(
  desktopId: string,
  input: { email: string; role: SharingRole },
) {
  return request(API_ROUTES.desktopMembers(desktopId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export async function updateMember(
  desktopId: string,
  userId: string,
  memberRole: SharingRole,
) {
  await request(API_ROUTES.desktopMember(desktopId, userId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: memberRole }),
  });
}
export async function removeMember(desktopId: string, userId: string) {
  await request(API_ROUTES.desktopMember(desktopId, userId), {
    method: "DELETE",
  });
}
export async function revokeInvitation(desktopId: string, email: string) {
  await request(API_ROUTES.desktopInvitation(desktopId, email), {
    method: "DELETE",
  });
}
export async function publishDesktop(
  desktopId: string,
  input: { alias: string; shareEntire: boolean },
) {
  if (!isValidPublicationAlias(input.alias))
    throw new Error("The desktop alias is invalid.");
  return request(API_ROUTES.desktopPublication(desktopId), {
    method: "PUT",
    headers: publicationHeaders(),
    body: JSON.stringify(input),
  });
}
export async function unpublishDesktop(desktopId: string) {
  await request(API_ROUTES.desktopPublication(desktopId), {
    method: "DELETE",
    headers: publicationHeaders(),
  });
}
export async function publishItem(
  desktopId: string,
  entryId: string,
  input: { alias: string; desktopAlias?: string },
) {
  if (
    !isValidPublicationAlias(input.alias) ||
    (input.desktopAlias !== undefined &&
      !isValidPublicationAlias(input.desktopAlias))
  )
    throw new Error("The publication alias is invalid.");
  return request(API_ROUTES.desktopItemPublication(desktopId, entryId), {
    method: "PUT",
    headers: publicationHeaders(),
    body: JSON.stringify(input),
  });
}
export async function unpublishItem(desktopId: string, entryId: string) {
  await request(API_ROUTES.desktopItemPublication(desktopId, entryId), {
    method: "DELETE",
    headers: publicationHeaders(),
  });
}

export function suggestAlias(name: string) {
  const alias = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
    .replace(/-$/g, "");
  return alias.length >= 3 ? alias : `${alias || "shared"}-item`;
}

export function isValidPublicationAlias(value: string) {
  return /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(value);
}

export function confirmDesktopAliasChange(
  currentAlias: string | undefined,
  nextAlias: string,
  confirmImpl: (message: string) => boolean = (message) =>
    window.confirm(message),
) {
  return (
    !currentAlias ||
    currentAlias === nextAlias ||
    confirmImpl(
      `Change the desktop alias from “${currentAlias}” to “${nextAlias}”? Every whole-desktop and published-item URL will change, and the old URLs will stop working.`,
    )
  );
}

export function confirmItemAliasChange(
  currentAlias: string | undefined,
  nextAlias: string,
  confirmImpl: (message: string) => boolean = (message) =>
    window.confirm(message),
) {
  return (
    !currentAlias ||
    currentAlias === nextAlias ||
    confirmImpl(
      `Change the item alias from “${currentAlias}” to “${nextAlias}”? The old public URL will stop working.`,
    )
  );
}
