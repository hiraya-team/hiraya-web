import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CaretRight, Desktop, FolderPlus, X } from "@phosphor-icons/react";
import type { DialogRequest } from "../apps/host/dialogs";
import { matchingFileType } from "../apps/installed-apps";
import type { DesktopEntry, FileEntry, FolderEntry } from "../types";
import { createEntryIndex } from "../ui/entry-index";
import { useNativeDialog } from "../ui/modal-dialog";
import { FileDialog } from "./FileDialog";
import { EntryIcon } from "./VisualPrimitives";

type Props = {
  request: Extract<DialogRequest, { kind: "openFile" | "openFolder" | "saveFile" }> | { kind: "pickFile"; params: { mimeTypes: string[]; title: string; actionLabel: string } };
  entries: DesktopEntry[];
  onCancel: () => void;
  onOpenFiles: (files: FileEntry[]) => void;
  onOpenFolder: (folder: FolderEntry | null) => void;
  onSave: (name: string, folder: FolderEntry | null) => Promise<void>;
  onCreateFolder?: (name: string, parentId: string | null) => Promise<FolderEntry>;
};

const ROOT_ID = "desktop-root";

export function AppPickerDialog({ request, entries, onCancel, onOpenFiles, onOpenFolder, onSave, onCreateFolder }: Props) {
  const pickingFile = request.kind === "openFile" || request.kind === "pickFile";
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [folderId, setFolderId] = useState("");
  const [expanded, setExpanded] = useState(() => new Set([ROOT_ID]));
  const [name, setName] = useState(request.kind === "saveFile" ? request.params.suggestedName ?? "untitled" : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  useNativeDialog(dialogRef, onCancel, busy);

  const index = useMemo(() => createEntryIndex(entries), [entries]);
  const files = useMemo(() => entries.filter((entry): entry is FileEntry => entry.kind === "file" && (
    !pickingFile || !request.params.mimeTypes?.length || request.params.mimeTypes.some((matcher) => matchingFileType(entry, matcher))
  )), [entries, pickingFile, request.params]);
  const fileIds = useMemo(() => new Set(files.map((file) => file.id)), [files]);
  const children = useMemo(() => {
    const result = new Map<string | null, DesktopEntry[]>();
    for (const [parentId, items] of index.children) {
      result.set(parentId, items
        .filter((entry) => entry.kind === "folder" || pickingFile && fileIds.has(entry.id))
        .toSorted((a, b) => Number(b.kind === "folder") - Number(a.kind === "folder") || a.name.localeCompare(b.name)));
    }
    return result;
  }, [fileIds, index, pickingFile]);
  const selectedFiles = files.filter((file) => selected.includes(file.id));
  const selectedFolder = folderId ? index.byId.get(folderId) : null;
  const folderIsMissing = Boolean(folderId && selectedFolder?.kind !== "folder");
  const multiple = request.kind === "openFile" && request.params.multiple === true;
  const title = request.kind === "pickFile" ? request.params.title : request.kind === "openFile" ? multiple ? "Choose files" : "Choose file" : request.kind === "openFolder" ? "Choose folder" : "Save file";

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectFile(id: string, checked: boolean) {
    setSelected((current) => checked
      ? multiple ? current.includes(id) ? current : [...current, id] : [id]
      : current.filter((item) => item !== id));
  }

  function folderRow(id: string, label: string, icon: ReactNode, depth: number, hasChildren: boolean) {
    const isExpanded = expanded.has(id);
    const style = { "--picker-depth": depth } as CSSProperties;
    if (pickingFile) {
      return hasChildren ? <button className="app-picker__folder-toggle" type="button" style={style} aria-expanded={isExpanded} onClick={() => toggleExpanded(id)}>
        <CaretRight className="app-picker__caret" size={16} aria-hidden="true" />{icon}<span title={label}>{label}</span>
      </button> : <div className="app-picker__folder-toggle" style={style}>
        <span className="app-picker__caret" />{icon}<span title={label}>{label}</span>
      </div>;
    }
    return <div className="app-picker__folder-row" style={style} data-selected={folderId === (id === ROOT_ID ? "" : id) || undefined}>
      {hasChildren ? <button className="app-picker__disclosure" type="button" aria-label={`${isExpanded ? "Collapse" : "Expand"} ${label}`} aria-expanded={isExpanded} onClick={() => toggleExpanded(id)}>
        <CaretRight className="app-picker__caret" size={16} aria-hidden="true" />
      </button> : <span className="app-picker__disclosure" />}
      <label><input type="radio" name="picked-folder" checked={folderId === (id === ROOT_ID ? "" : id)} onChange={() => setFolderId(id === ROOT_ID ? "" : id)} />{icon}<span title={label}>{label}</span></label>
    </div>;
  }

  function renderChildren(parentId: string | null, depth: number): ReactNode {
    return (children.get(parentId) ?? []).map((entry) => {
      if (entry.kind === "folder") {
        const hasChildren = Boolean(children.get(entry.id)?.length);
        return <li key={entry.id}>
          {folderRow(entry.id, entry.name, <EntryIcon entry={entry} size={20} />, depth, hasChildren)}
          {hasChildren && expanded.has(entry.id) && <ul className="app-picker__branch">{renderChildren(entry.id, depth + 1)}</ul>}
        </li>;
      }
      const isSelected = selected.includes(entry.id);
      return <li key={entry.id}>
        <label className="app-picker__file" data-selected={isSelected || undefined} style={{ "--picker-depth": depth } as CSSProperties}>
          <input type={multiple ? "checkbox" : "radio"} name="picked-file" checked={isSelected} onChange={(event) => selectFile(entry.id, event.target.checked)} />
          <EntryIcon entry={entry} size={20} /><span title={entry.name}>{entry.name}</span>
        </label>
      </li>;
    });
  }

  async function submit() {
    if (pickingFile) {
      onOpenFiles(selectedFiles);
      return;
    }
    if (folderIsMissing) {
      setError("The selected folder is no longer available. Choose another folder.");
      return;
    }
    const folder = selectedFolder?.kind === "folder" ? selectedFolder : null;
    if (request.kind === "openFolder") { onOpenFolder(folder); return; }
    setBusy(true);
    setError("");
    try { await onSave(name, folder); } catch (reason) { setError(reason instanceof Error ? reason.message : "The file could not be saved."); setBusy(false); }
  }

  async function createPickedFolder(name: string) {
    if (!onCreateFolder) return;
    const parentId = folderId || null;
    const folder = await onCreateFolder(name, parentId);
    setExpanded((current) => new Set(current).add(parentId ?? ROOT_ID));
    setFolderId(folder.id);
    setCreatingFolder(false);
  }

  const selectionStatus = pickingFile
    ? multiple ? `${selectedFiles.length} ${selectedFiles.length === 1 ? "file" : "files"} selected` : selectedFiles[0]?.name ?? "Select a file"
    : `${selectedFolder?.name ?? "Desktop"} selected`;
  const actionLabel = request.kind === "pickFile" ? request.params.actionLabel : request.kind === "saveFile" ? "Save" : request.kind === "openFolder" ? "Choose folder" : multiple ? selectedFiles.length ? `Choose ${selectedFiles.length} ${selectedFiles.length === 1 ? "file" : "files"}` : "Choose files" : "Choose file";

  return <><dialog ref={dialogRef} className="modal-backdrop" aria-labelledby="app-picker-title" onPointerDown={(event) => event.target === event.currentTarget && !busy && onCancel()}>
    <section className="file-dialog app-picker">
      <header className="window-header"><div><span className="window-kicker">Hiraya</span><h2 id="app-picker-title">{title}</h2></div><button className="icon-button" type="button" onClick={onCancel} disabled={busy} aria-label="Close dialog"><X size={18} /></button></header>
      <div className="app-picker__content">
        {request.kind === "saveFile" && <label>File name<input autoFocus data-dialog-autofocus value={name} maxLength={180} onChange={(event) => setName(event.target.value)} /></label>}
        <div className="app-picker__tree" role="group" aria-label={pickingFile ? "Files" : "Folders"}>
          <ul className="app-picker__branch">
            <li>
              {folderRow(ROOT_ID, "Desktop", <Desktop size={20} weight="duotone" aria-hidden="true" />, 0, Boolean(children.get(null)?.length))}
              {expanded.has(ROOT_ID) && <ul className="app-picker__branch">{renderChildren(null, 1)}</ul>}
            </li>
          </ul>
          {pickingFile && files.length === 0 && <p className="app-picker__empty" role="status">No matching files are available.</p>}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="app-picker__footer">
          <div className="app-picker__footer-context">
            {!pickingFile && onCreateFolder && <button className="button button--quiet" type="button" disabled={busy} aria-label={`New folder in ${selectedFolder?.name ?? "Desktop"}`} onClick={() => setCreatingFolder(true)}><FolderPlus size={17} /> New folder</button>}
            <span className="app-picker__selection-status" aria-live="polite">{selectionStatus}</span>
          </div>
          <div className="dialog-actions"><button className="button button--quiet" type="button" onClick={onCancel} disabled={busy}>Cancel</button><button className="button button--primary" type="button" disabled={busy || folderIsMissing || pickingFile && selectedFiles.length === 0 || request.kind === "saveFile" && !name.trim()} onClick={() => void submit()}>{busy ? "Saving..." : actionLabel}</button></div>
        </div>
      </div>
    </section>
  </dialog>
  {creatingFolder && <FileDialog dialog={{ type: "create-folder", parentId: folderId || null }} entry={null} onClose={() => setCreatingFolder(false)} onSubmit={createPickedFolder} />}
  </>;
}
