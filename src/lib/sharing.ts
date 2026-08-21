import {
  createWeb2InvitationToken,
  deleteWeb2NodePublication,
  deleteWeb2Publication,
  deleteWeb2SharingAudience,
  deleteWeb2SharingMember,
  deleteWeb2WorkspaceInvitation,
  fetchWeb2Publication,
  fetchWeb2Sharing,
  fetchWeb2WorkspaceInvitations,
  putWeb2NodePublication,
  putWeb2Publication,
  putWeb2SharingAudience,
  putWeb2WorkspaceInvitation,
  updateWeb2SharingMember,
} from "../sync/transport";
import { WEB2_SYNC_PROTOCOL } from "../sync/constants";
import { isValidPublicationAlias } from "./publication-alias";

export { isValidPublicationAlias } from "./publication-alias";

export type SharingRole = "manager" | "writer" | "reader";
export type SharingMember = { userId: string; displayName: string; email?: string; avatar: string | null; role: "owner" | SharingRole };
export type SharingInvitation = { id: string; email: string; role: SharingRole; url?: string; token?: string };
export type PublishedItem = { entryId: string; alias: string; name: string; kind: "file" | "folder"; url: string };
export type DesktopPublication = { configured: boolean; baseUrl: string; desktopAlias?: string; shareEntire: boolean; url?: string; items: PublishedItem[] };
export type DesktopAudience = { kind: "authenticated-users"; role: SharingRole };
export type SharingState = { members: SharingMember[]; pending: SharingInvitation[]; publication: DesktopPublication; audience: DesktopAudience | null };

/** Provides the synchronized sharing transport. */
const wire = { schemaVersion: 1 as const, protocol: WEB2_SYNC_PROTOCOL };

/** Fetches sharing settings for a desktop. */
export async function getSharing(workspaceId: string): Promise<SharingState> {
  const [sharing, invitations, publication] = await Promise.all([fetchWeb2Sharing(workspaceId), fetchWeb2WorkspaceInvitations(workspaceId), fetchWeb2Publication(workspaceId)]);
  return {
    members: sharing.members.map((member) => ({ ...member, avatar: null })),
    pending: invitations.invitations.map((invitation) => ({ ...invitation })),
    audience: sharing.audience,
    publication: {
      configured: true,
      baseUrl: "/published",
      ...(publication.alias ? { desktopAlias: publication.alias } : {}),
      ...(publication.url ? { url: publication.url } : {}),
      shareEntire: publication.shareEntire,
      items: publication.items.map(({ nodeId, ...item }) => ({ ...item, entryId: nodeId })),
    },
  };
}

/** Returns invite member. */
export async function inviteMember(workspaceId: string, input: { email: string; role: SharingRole }) {
  const invitation = { id: crypto.randomUUID(), token: createWeb2InvitationToken() };
  await putWeb2WorkspaceInvitation(workspaceId, crypto.randomUUID(), { ...wire, ...invitation, email: input.email, role: input.role });
  return { ...invitation, invitationUrl: `/register?token=${encodeURIComponent(invitation.token)}` };
}

/** Updates member. */
export function updateMember(workspaceId: string, userId: string, role: SharingRole) {
  return updateWeb2SharingMember(workspaceId, userId, crypto.randomUUID(), { ...wire, role });
}

/** Removes member. */
export function removeMember(workspaceId: string, userId: string) {
  return deleteWeb2SharingMember(workspaceId, userId, crypto.randomUUID());
}

/** Returns revoke invitation. */
export function revokeInvitation(workspaceId: string, invitationId: string) {
  return deleteWeb2WorkspaceInvitation(workspaceId, invitationId, crypto.randomUUID());
}

/** Sets audience. */
export function setAudience(workspaceId: string, role: SharingRole | null) {
  return role === null ? deleteWeb2SharingAudience(workspaceId, crypto.randomUUID()) : putWeb2SharingAudience(workspaceId, crypto.randomUUID(), { ...wire, role });
}

/** Publishes desktop. */
export async function publishDesktop(workspaceId: string, input: { alias: string; shareEntire: boolean }) {
  if (!isValidPublicationAlias(input.alias)) throw new Error("The desktop alias is invalid.");
  await putWeb2Publication(workspaceId, crypto.randomUUID(), { ...wire, ...input });
}

/** Returns unpublish desktop. */
export function unpublishDesktop(workspaceId: string) {
  return deleteWeb2Publication(workspaceId, crypto.randomUUID());
}

/** Publishes item. */
export async function publishItem(workspaceId: string, entryId: string, input: { alias: string; desktopAlias?: string }) {
  if (!isValidPublicationAlias(input.alias) || input.desktopAlias !== undefined && !isValidPublicationAlias(input.desktopAlias)) throw new Error("The publication alias is invalid.");
  const publication = await fetchWeb2Publication(workspaceId);
  if (input.desktopAlias && input.desktopAlias !== publication.alias) await putWeb2Publication(workspaceId, crypto.randomUUID(), { ...wire, alias: input.desktopAlias, shareEntire: publication.shareEntire });
  await putWeb2NodePublication(workspaceId, entryId, crypto.randomUUID(), { ...wire, alias: input.alias });
}

/** Returns unpublish item. */
export function unpublishItem(workspaceId: string, entryId: string) {
  return deleteWeb2NodePublication(workspaceId, entryId, crypto.randomUUID());
}

/** Returns suggest alias. */
export function suggestAlias(name: string) {
  const alias = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48).replace(/-$/g, "");
  return alias.length >= 3 ? alias : `${alias || "shared"}-item`;
}

/** Returns confirm desktop alias change. */
export function confirmDesktopAliasChange(currentAlias: string | undefined, nextAlias: string, confirmImpl: (message: string) => boolean = (message) => window.confirm(message)) {
  return !currentAlias || currentAlias === nextAlias || confirmImpl(`Change the desktop alias from “${currentAlias}” to “${nextAlias}”? Every whole-desktop and published-item URL will change, and the old URLs will stop working.`);
}

/** Returns confirm item alias change. */
export function confirmItemAliasChange(currentAlias: string | undefined, nextAlias: string, confirmImpl: (message: string) => boolean = (message) => window.confirm(message)) {
  return !currentAlias || currentAlias === nextAlias || confirmImpl(`Change the item alias from “${currentAlias}” to “${nextAlias}”? The old public URL will stop working.`);
}
