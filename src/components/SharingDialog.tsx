import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  ArrowSquareOut,
  Check,
  Copy,
  Globe,
  LinkSimple,
  Plus,
  Trash,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import {
  confirmDesktopAliasChange,
  getSharing,
  inviteMember,
  isValidPublicationAlias,
  publishDesktop,
  removeMember,
  revokeInvitation,
  suggestAlias,
  unpublishDesktop,
  unpublishItem,
  updateMember,
  type SharingRole,
  type SharingState,
} from "../lib/sharing";
import type { DesktopIdentity } from "../types";
import { useModalDialog } from "../ui/modal-dialog";
import { writeClipboardText } from "../ui/clipboard-copy";
import { RoleBadge } from "./VisualPrimitives";

const ROLES: SharingRole[] = ["reader", "writer", "manager"];

function publicUrl(publication: SharingState["publication"]) {
  return publication.url
    ? new URL(publication.url, window.location.href).href
    : "";
}

export function SharingDialog({
  desktop,
  onClose,
  onOpenHelp,
  restoreFocus,
}: {
  desktop: DesktopIdentity;
  onClose: () => void;
  onOpenHelp: () => void;
  restoreFocus?: () => HTMLElement | null;
}) {
  const [sharing, setSharing] = useState<SharingState | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<SharingRole>("reader");
  const [desktopAlias, setDesktopAlias] = useState("");
  const [shareEntire, setShareEntire] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [lastInvite, setLastInvite] = useState<{
    url?: string;
    invitationUrl?: string;
    token?: string;
  } | null>(null);
  const [copied, setCopied] = useState("");
  const [copyFeedback, setCopyFeedback] = useState<{
    error: boolean;
    message: string;
  } | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const copyGenerationRef = useRef(0);
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useModalDialog(backdropRef, dialogRef, onClose, busy !== "", restoreFocus);

  function applySharing(next: SharingState) {
    setSharing(next);
    setDesktopAlias(
      next.publication.desktopAlias ?? suggestAlias(desktop.name),
    );
    setShareEntire(next.publication.shareEntire);
  }
  async function refresh() {
    applySharing(await getSharing(desktop.id));
  }
  const loadSharing = useEffectEvent(() =>
    getSharing(desktop.id)
      .then(applySharing)
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Sharing could not be loaded.",
        ),
      ),
  );
  useEffect(() => {
    void loadSharing();
    // useEffectEvent callbacks are intentionally non-reactive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop.id]);
  useEffect(
    () => () => {
      copyGenerationRef.current += 1;
      if (copiedTimerRef.current !== null)
        window.clearTimeout(copiedTimerRef.current);
    },
    [],
  );
  async function run(key: string, operation: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try {
      await operation();
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The sharing change could not be saved.",
      );
    } finally {
      setBusy("");
    }
  }
  async function copy(value: string, key: string, successMessage: string) {
    const generation = ++copyGenerationRef.current;
    if (copiedTimerRef.current !== null)
      window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = null;
    setCopied("");
    setCopyFeedback(null);
    const copiedSuccessfully = await writeClipboardText(
      navigator.clipboard,
      value,
    );
    if (!copiedSuccessfully) {
      if (copyGenerationRef.current === generation) {
        setCopyFeedback({
          error: true,
          message:
            "The link could not be copied. Check clipboard permission and try again.",
        });
      }
      return;
    }
    if (copyGenerationRef.current !== generation) return;
    setCopied(key);
    setCopyFeedback({ error: false, message: successMessage });
    const timer = window.setTimeout(() => {
      if (copyGenerationRef.current !== generation) return;
      setCopied("");
      setCopyFeedback(null);
      if (copiedTimerRef.current === timer) copiedTimerRef.current = null;
    }, 1800);
    copiedTimerRef.current = timer;
  }
  const publicationUrl = sharing ? publicUrl(sharing.publication) : "";

  return (
    <div
      ref={backdropRef}
      className="modal-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="file-window sharing-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sharing-title"
        tabIndex={-1}
        aria-busy={busy !== "" || undefined}
      >
        <header className="window-header">
          <div>
            <span className="window-kicker">Access and publication</span>
            <h2 id="sharing-title">Share {desktop.name}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            disabled={busy !== ""}
            onClick={onClose}
            aria-label="Close sharing"
          >
            <X size={18} />
          </button>
        </header>
        <div className="sharing-dialog__content">
          <section className="sharing-section">
            <div className="sharing-section__heading">
              <UsersThree size={20} />
              <div>
                <h3>People with access</h3>
                <p>
                  Managers can share and customize. Writers can organize and
                  edit files.
                </p>
              </div>
            </div>
            <form
              className="sharing-invite"
              onSubmit={(event) => {
                event.preventDefault();
                void run("invite", async () => {
                  const result = await inviteMember(desktop.id, {
                    email: email.trim(),
                    role,
                  });
                  if (result && typeof result === "object")
                    setLastInvite(
                      result as {
                        url?: string;
                        invitationUrl?: string;
                        token?: string;
                      },
                    );
                  setEmail("");
                });
              }}
            >
              <label>
                <span>Email address</span>
                <input
                  type="email"
                  required
                  value={email}
                  placeholder="person@example.com"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                <span>Role</span>
                <select
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value as SharingRole)
                  }
                >
                  {ROLES.map((value) => (
                    <option value={value} key={value}>
                      {value[0].toUpperCase() + value.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button button--primary"
                type="submit"
                disabled={busy !== "" || !email.trim()}
              >
                <Plus size={16} /> Invite
              </button>
            </form>
            {lastInvite &&
              (lastInvite.invitationUrl ||
                lastInvite.url ||
                lastInvite.token) && (
                <div className="sharing-token">
                  <div>
                    <strong>Invitation ready</strong>
                    <span>
                      {lastInvite.invitationUrl ||
                        lastInvite.url ||
                        lastInvite.token}
                    </span>
                  </div>
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() =>
                      void copy(
                        lastInvite.invitationUrl ||
                          lastInvite.url ||
                          lastInvite.token ||
                          "",
                        "invite",
                        "Invitation link copied.",
                      )
                    }
                  >
                    {copied === "invite" ? (
                      <Check size={15} />
                    ) : (
                      <Copy size={15} />
                    )}{" "}
                    {copied === "invite" ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
            {!sharing ? (
              <div className="sharing-loading">Loading people...</div>
            ) : (
              <div className="sharing-members">
                {sharing.audience && (
                  <div className="sharing-member">
                    <span className="sharing-avatar">
                      <Globe size={16} />
                    </span>
                    <div>
                      <strong>All authenticated users</strong>
                      <span>Deployment access · {sharing.audience.role}</span>
                    </div>
                    <RoleBadge>Default</RoleBadge>
                  </div>
                )}
                {sharing.members.map((member) => (
                  <div className="sharing-member" key={member.userId}>
                    <span className="sharing-avatar">
                      {member.avatar &&
                      !member.avatar.startsWith("identicon:") ? (
                        <img src={member.avatar} alt="" />
                      ) : (
                        member.displayName.slice(0, 1).toUpperCase()
                      )}
                    </span>
                    <div>
                      <strong>{member.displayName}</strong>
                      <span>
                        {member.email ||
                          (member.role === "owner"
                            ? "Desktop owner"
                            : "Member")}
                      </span>
                    </div>
                    {member.role === "owner" ? (
                      <RoleBadge>Owner</RoleBadge>
                    ) : (
                      <>
                        <select
                          aria-label={`Role for ${member.displayName}`}
                          value={member.role}
                          disabled={busy !== ""}
                          onChange={(event) =>
                            void run(`member-${member.userId}`, () =>
                              updateMember(
                                desktop.id,
                                member.userId,
                                event.target.value as SharingRole,
                              ),
                            )
                          }
                        >
                          {ROLES.map((value) => (
                            <option value={value} key={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                        <button
                          className="icon-button sharing-member__remove"
                          type="button"
                          disabled={busy !== ""}
                          onClick={() =>
                            void run(`member-${member.userId}`, () =>
                              removeMember(desktop.id, member.userId),
                            )
                          }
                          aria-label={`Remove ${member.displayName}`}
                        >
                          <Trash size={16} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {sharing.pending.map((invite) => (
                  <div
                    className="sharing-member sharing-member--pending"
                    key={invite.id}
                  >
                    <span className="sharing-avatar">
                      <LinkSimple size={16} />
                    </span>
                    <div>
                      <strong>{invite.email}</strong>
                      <span>Invitation pending · {invite.role}</span>
                      {(invite.url || invite.token) && (
                        <code>{invite.url || invite.token}</code>
                      )}
                    </div>
                    {(invite.url || invite.token) && (
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() =>
                          void copy(
                            invite.url || invite.token || "",
                            invite.id,
                            `Invitation for ${invite.email} copied.`,
                          )
                        }
                        aria-label={`Copy invitation for ${invite.email}`}
                      >
                        {copied === invite.id ? (
                          <Check size={16} />
                        ) : (
                          <Copy size={16} />
                        )}
                      </button>
                    )}
                    <button
                      className="icon-button sharing-member__remove"
                      type="button"
                      disabled={busy !== ""}
                      onClick={() =>
                        void run(`invite-${invite.id}`, () =>
                          revokeInvitation(desktop.id, invite.email),
                        )
                      }
                      aria-label={`Revoke invitation for ${invite.email}`}
                    >
                      <Trash size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="sharing-section">
            <div className="sharing-section__heading">
              <Globe size={20} />
              <div>
                <h3>Public address</h3>
                <p>
                  Choose the stable desktop address. Individual items remain
                  scoped even when the whole desktop is private.
                </p>
              </div>
            </div>
            {sharing && !sharing.publication.configured && (
              <p className="form-error" role="status">
                Public sharing is not configured on this server.
              </p>
            )}
            {sharing?.publication.configured && (
              <form
                className="publication-settings"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (
                    confirmDesktopAliasChange(
                      sharing.publication.desktopAlias,
                      desktopAlias,
                    )
                  )
                    void run("publication", () =>
                      publishDesktop(desktop.id, {
                        alias: desktopAlias,
                        shareEntire,
                      }),
                    );
                }}
              >
                <label>
                  <span>Desktop alias</span>
                  <input
                    value={desktopAlias}
                    minLength={3}
                    maxLength={48}
                    pattern="[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])"
                    onChange={(event) =>
                      setDesktopAlias(event.target.value.toLowerCase())
                    }
                  />
                </label>
                <label className="publication-toggle">
                  <input
                    type="checkbox"
                    checked={shareEntire}
                    onChange={(event) => setShareEntire(event.target.checked)}
                  />
                  <span>
                    <strong>Share entire desktop</strong>
                    <small>
                      Anyone with the desktop address can browse every live item
                      and the desktop appearance.
                    </small>
                  </span>
                </label>
                <div className="publication-actions">
                  <button
                    className="button button--primary"
                    type="submit"
                    disabled={
                      busy !== "" || !isValidPublicationAlias(desktopAlias)
                    }
                  >
                    Save public address
                  </button>
                  {publicationUrl && sharing.publication.shareEntire && (
                    <>
                      <button
                        className="button button--quiet"
                        type="button"
                        onClick={() =>
                          void copy(
                            publicationUrl,
                            "public",
                            "Public address copied.",
                          )
                        }
                      >
                        {copied === "public" ? (
                          <Check size={15} />
                        ) : (
                          <Copy size={15} />
                        )}{" "}
                        {copied === "public" ? "Copied" : "Copy"}
                      </button>
                      <a
                        className="button button--quiet"
                        href={publicationUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ArrowSquareOut size={15} /> Open
                      </a>
                    </>
                  )}
                </div>
                {publicationUrl && (
                  <div className="publication-card">
                    <div>
                      <span>
                        {sharing.publication.shareEntire
                          ? "Public desktop"
                          : "Address reserved · desktop private"}
                      </span>
                      <strong>{publicationUrl}</strong>
                    </div>
                    {sharing.publication.shareEntire && (
                      <button
                        className="button button--danger"
                        type="button"
                        disabled={busy !== ""}
                        onClick={() =>
                          void run("unpublish", () =>
                            unpublishDesktop(desktop.id),
                          )
                        }
                      >
                        Turn off
                      </button>
                    )}
                  </div>
                )}
              </form>
            )}
            {sharing && sharing.publication.items.length > 0 && (
              <div className="published-items">
                <strong>Published items</strong>
                {sharing.publication.items.map((item) => (
                  <div className="sharing-member" key={item.entryId}>
                    <span className="sharing-avatar">
                      <LinkSimple size={16} />
                    </span>
                    <div>
                      <strong>{item.name}</strong>
                      <span>
                        {item.kind} · /{item.alias}
                      </span>
                    </div>
                    <a
                      className="icon-button"
                      href={new URL(item.url, window.location.href).href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${item.name} public link`}
                    >
                      <ArrowSquareOut size={16} />
                    </a>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() =>
                        void copy(
                          new URL(item.url, window.location.href).href,
                          item.entryId,
                          `Link for ${item.name} copied.`,
                        )
                      }
                      aria-label={`Copy link for ${item.name}`}
                    >
                      {copied === item.entryId ? (
                        <Check size={16} />
                      ) : (
                        <Copy size={16} />
                      )}
                    </button>
                    <button
                      className="icon-button sharing-member__remove"
                      type="button"
                      disabled={busy !== ""}
                      onClick={() =>
                        void run(`unpublish-${item.entryId}`, () =>
                          unpublishItem(desktop.id, item.entryId),
                        )
                      }
                      aria-label={`Unpublish ${item.name}`}
                    >
                      <Trash size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          <button
            className="inline-help-link"
            type="button"
            onClick={onOpenHelp}
          >
            Sharing roles and public-link safety
          </button>
          {copyFeedback && (
            <p
              className={copyFeedback.error ? "form-error" : "visually-hidden"}
              role={copyFeedback.error ? "alert" : "status"}
              aria-live={copyFeedback.error ? "assertive" : "polite"}
            >
              {copyFeedback.message}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
