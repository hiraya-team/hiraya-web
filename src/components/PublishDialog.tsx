import { useEffect, useRef, useState } from "react";
import { ArrowSquareOut, Check, Copy, Globe, X } from "@phosphor-icons/react";
import {
  confirmDesktopAliasChange,
  confirmItemAliasChange,
  getSharing,
  isValidPublicationAlias,
  publishItem,
  suggestAlias,
  unpublishItem,
  type SharingState,
} from "../lib/sharing";
import type { DesktopEntry, DesktopIdentity } from "../types";
import { writeClipboardText } from "../ui/clipboard-copy";
import { useNativeDialog } from "../ui/modal-dialog";
import { useStableHandler } from "../ui/use-stable-handler";

/** Renders the publish dialog interface. */
export function PublishDialog({
  desktop,
  entry,
  onClose,
}: {
  desktop: DesktopIdentity;
  entry: DesktopEntry;
  onClose: () => void;
}) {
  const [sharing, setSharing] = useState<SharingState | null>(null);
  const [desktopAlias, setDesktopAlias] = useState("");
  const [itemAlias, setItemAlias] = useState(
    suggestAlias(entry.name.replace(/\.[^.]+$/, "")),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useNativeDialog(dialogRef, onClose, busy);

  async function refresh() {
    const next = await getSharing(desktop.id);
    const published = next.publication.items.find(
      (item) => item.entryId === entry.id,
    );
    setSharing(next);
    setDesktopAlias(
      next.publication.desktopAlias ?? suggestAlias(desktop.name),
    );
    if (published) setItemAlias(published.alias);
  }
  const loadSharing = useStableHandler(() =>
    refresh().catch((reason) =>
      setError(
        reason instanceof Error
          ? reason.message
          : "Publication settings could not be loaded.",
      ),
    ),
  );
  useEffect(() => {
    void loadSharing();
  }, [desktop.id, entry.id, loadSharing]);
  const published = sharing?.publication.items.find(
    (item) => item.entryId === entry.id,
  );
  const preview =
    sharing?.publication.configured && desktopAlias && itemAlias
      ? new URL(
          `${sharing.publication.baseUrl}/${desktopAlias}/${itemAlias}`,
          window.location.href,
        ).href
      : "";

  async function save() {
    if (
      !confirmDesktopAliasChange(
        sharing?.publication.desktopAlias,
        desktopAlias,
      ) ||
      !confirmItemAliasChange(published?.alias, itemAlias)
    )
      return;
    setBusy(true);
    setError("");
    try {
      await publishItem(desktop.id, entry.id, {
        alias: itemAlias,
        desktopAlias,
      });
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The item could not be published.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal-backdrop"
      aria-labelledby="publish-title"
      onPointerDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <section className="file-window sharing-dialog publish-dialog" aria-busy={busy || undefined}>
        <header className="window-header">
          <div>
            <h2 id="publish-title">Publish {entry.name}</h2>
            <span className="window-kicker">Public · Read only</span>
          </div>
          <button
            className="icon-button"
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Close publication dialog"
          >
            <X size={18} />
          </button>
        </header>
        <div className="sharing-dialog__content">
          <div className="sharing-section__heading">
            <Globe size={20} />
            <div>
              <h3>Stable public address</h3>
              <p>
                Only this{" "}
                {entry.kind === "folder"
                  ? "folder and its live contents"
                  : "file"}{" "}
                will be visible. The rest of the desktop stays private.
              </p>
            </div>
          </div>
          {entry.kind === "folder" && (
            <p className="publication-warning">
              Files added inside this folder later will become public
              automatically.
            </p>
          )}
          {!sharing ? (
            <div className="sharing-loading" role="status">
              Loading publication...
            </div>
          ) : !sharing.publication.configured ? (
            <p className="form-error" role="status">
              Public sharing is not configured on this server.
            </p>
          ) : (
            <form
              className="publication-aliases"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
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
              <label>
                <span>Item alias</span>
                <input
                  autoFocus
                  data-dialog-autofocus
                  value={itemAlias}
                  minLength={3}
                  maxLength={48}
                  pattern="[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])"
                  onChange={(event) =>
                    setItemAlias(event.target.value.toLowerCase())
                  }
                />
              </label>
              {preview && (
                <div className="publication-preview">
                  <span>Public URL</span>
                  <strong>{preview}</strong>
                </div>
              )}
              <p className="publication-disclosure">
                Anyone with this address can view and download the published
                content. Renaming either alias breaks the old address
                permanently.
              </p>
              <div className="publication-actions">
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={
                    busy ||
                    !isValidPublicationAlias(desktopAlias) ||
                    !isValidPublicationAlias(itemAlias)
                  }
                >
                  {published ? "Save alias" : "Publish"}
                </button>
                {published && (
                  <>
                    <button
                      className="button button--quiet"
                      type="button"
                      onClick={() =>
                        void writeClipboardText(
                          navigator.clipboard,
                          new URL(published.url, window.location.href).href,
                        ).then((success) => {
                          setCopied(success);
                          if (!success)
                            setError(
                              "The link could not be copied. Check clipboard permission and try again.",
                            );
                        })
                      }
                    >
                      {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
                      {copied ? "Copied" : "Copy"}
                    </button>
                    <a
                      className="button button--quiet"
                      href={new URL(published.url, window.location.href).href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ArrowSquareOut size={15} /> Open
                    </a>
                    <button
                      className="button button--danger"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        void unpublishItem(desktop.id, entry.id)
                          .then(onClose)
                          .catch((reason) => {
                            setError(
                              reason instanceof Error
                                ? reason.message
                                : "The item could not be unpublished.",
                            );
                            setBusy(false);
                          });
                      }}
                    >
                      Unpublish
                    </button>
                  </>
                )}
              </div>
            </form>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>
    </dialog>
  );
}
