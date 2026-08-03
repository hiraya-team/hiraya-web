import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, File, FloppyDisk, GitMerge, SpinnerGap, WarningCircle } from "@phosphor-icons/react";

export type MergeFileVersion = {
  name: string;
  mimeType: string;
  size: number;
  modifiedAt: number;
  content?: Blob;
};

export type MergeTextResolution = "mine" | "server" | "both";

export type MergeTextConflict = {
  id: string;
  label?: string;
  base: string;
  mine: string;
  server: string;
  resolution: MergeTextResolution | null;
};

type MergeWindowCommonProps = {
  mine: MergeFileVersion;
  server: MergeFileVersion;
  state: "ready" | "loading" | "resolving" | "error";
  error?: string;
  onRetry?: () => void;
  onKeepMine: () => void;
  onKeepServer: () => void;
  onKeepBoth: () => void;
};

export type MergeWindowProps = MergeWindowCommonProps & (
  | {
      mode: "text";
      conflicts: readonly MergeTextConflict[];
      mergedText: string;
      onMergedTextChange: (value: string) => void;
      onResolveConflict: (conflictId: string, resolution: MergeTextResolution) => void;
      onSaveMerged: () => void;
    }
  | {
      mode: "media";
      mediaKind: "image" | "audio" | "video" | "pdf";
    }
  | {
      mode: "binary";
    }
);

type Source = "base" | "mine" | "server";
type VersionSource = Exclude<Source, "base">;

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const numberFormatter = new Intl.NumberFormat();

function formatSize(bytes: number) {
  if (bytes < 1024) return `${numberFormatter.format(bytes)} ${bytes === 1 ? "byte" : "bytes"}`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: value < 10 ? 2 : 1 }).format(value)} ${units[unit]}`;
}

function useObjectUrl(content?: Blob) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!content) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(content);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [content]);
  return url;
}

function handleTabKeys<T extends string>(event: KeyboardEvent<HTMLButtonElement>, tabs: readonly T[], selected: T, select: (tab: T) => void) {
  const keyIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowLeft" ? tabs.indexOf(selected) - 1 : event.key === "ArrowRight" ? tabs.indexOf(selected) + 1 : -1;
  if (keyIndex === -1) return;
  event.preventDefault();
  const next = tabs[(keyIndex + tabs.length) % tabs.length];
  select(next);
  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[tabs.indexOf(next)]?.focus();
}

function SourceTabs<T extends string>({ tabs, selected, onSelect, label }: { tabs: readonly T[]; selected: T; onSelect: (tab: T) => void; label: string }) {
  return <div className="merge-window__source-tabs" role="tablist" aria-label={label}>
    {tabs.map((tab) => <button key={tab} type="button" role="tab" aria-selected={selected === tab} tabIndex={selected === tab ? 0 : -1} onClick={() => onSelect(tab)} onKeyDown={(event) => handleTabKeys(event, tabs, selected, onSelect)}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}
  </div>;
}

function VersionDetails({ version, label }: { version: MergeFileVersion; label: VersionSource }) {
  return <section className="merge-window__version-details" aria-label={`${label} file details`}>
    <div className="merge-window__file-mark" aria-hidden="true"><File size={28} weight="duotone" /></div>
    <h3>{version.name}</h3>
    <dl>
      <div><dt>Type</dt><dd>{version.mimeType}</dd></div>
      <div><dt>Size</dt><dd>{formatSize(version.size)}</dd></div>
      <div><dt>Modified</dt><dd><time dateTime={new Date(version.modifiedAt).toISOString()}>{dateFormatter.format(version.modifiedAt)}</time></dd></div>
    </dl>
  </section>;
}

function MediaPreview({ version, label, kind, active }: { version: MergeFileVersion; label: VersionSource; kind: "image" | "audio" | "video" | "pdf"; active: boolean }) {
  const url = useObjectUrl(version.content);
  const mediaRef = useRef<HTMLMediaElement>(null);
  useEffect(() => {
    const media = mediaRef.current;
    if (!media || active) return;
    media.pause();
  }, [active]);
  useEffect(() => () => {
    const media = mediaRef.current;
    if (!media) return;
    media.pause();
    media.removeAttribute("src");
    media.load();
  }, []);

  return <section className="merge-window__version merge-window__media-version" data-source={label} data-mobile-active={active || undefined} aria-label={`${label} version`}>
    <header><strong>{label === "mine" ? "Mine" : "Server"}</strong><span>{dateFormatter.format(version.modifiedAt)}</span></header>
    <div className="merge-window__preview">
      {!url ? <div className="merge-window__preview-placeholder" role="status">Preparing {label} preview...</div> : kind === "image" ? <img src={url} alt={`${label} version of ${version.name}`} /> : kind === "pdf" ? <iframe src={url} title={`${label} version of ${version.name}`} sandbox="" referrerPolicy="no-referrer" /> : kind === "video" ? <video ref={mediaRef as React.RefObject<HTMLVideoElement>} src={url} controls aria-label={`${label} video version of ${version.name}`} /> : <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} src={url} controls aria-label={`${label} audio version of ${version.name}`} />}
    </div>
    <p>{version.name} · {formatSize(version.size)}</p>
  </section>;
}

function TextMerge(props: Extract<MergeWindowProps, { mode: "text" }>) {
  const firstConflict = props.conflicts[0]?.id ?? "";
  const [activeConflictId, setActiveConflictId] = useState(firstConflict);
  const [source, setSource] = useState<Source>("mine");
  const resultId = useId();
  const activeConflict = props.conflicts.find((conflict) => conflict.id === activeConflictId) ?? props.conflicts[0];
  const unresolved = props.conflicts.filter((conflict) => conflict.resolution === null);

  useEffect(() => {
    if (!props.conflicts.some((conflict) => conflict.id === activeConflictId)) setActiveConflictId(props.conflicts[0]?.id ?? "");
  }, [activeConflictId, props.conflicts]);

  return <div className="merge-window__text-layout">
    <nav className="merge-window__navigator" aria-label="Text conflicts">
      <div><strong>Conflicts</strong><span aria-live="polite">{unresolved.length} unresolved</span></div>
      <ol>
        {props.conflicts.map((conflict, index) => <li key={conflict.id}><button type="button" aria-current={conflict.id === activeConflict?.id ? "true" : undefined} onClick={() => setActiveConflictId(conflict.id)}><span>{conflict.label || `Conflict ${index + 1}`}</span>{conflict.resolution ? <small><Check size={14} aria-hidden="true" /> Resolved with {conflict.resolution}</small> : <small><WarningCircle size={14} aria-hidden="true" /> Needs a choice</small>}</button></li>)}
      </ol>
    </nav>
    <div className="merge-window__text-workspace">
      {activeConflict ? <section className="merge-window__conflict" aria-labelledby={`${resultId}-conflict`}>
        <header><div><h2 id={`${resultId}-conflict`}>{activeConflict.label || "Choose the text to keep"}</h2><p>Compare the original with your edit and the server version.</p></div><span>{activeConflict.resolution ? `Resolved with ${activeConflict.resolution}` : "Unresolved"}</span></header>
        <SourceTabs tabs={["base", "mine", "server"] as const} selected={source} onSelect={setSource} label="Conflict sources" />
        <div className="merge-window__snippets">
          {(["base", "mine", "server"] as const).map((item) => <article key={item} data-source={item} data-mobile-active={source === item || undefined}><h3>{item === "base" ? "Base" : item === "mine" ? "Mine" : "Server"}</h3><pre>{activeConflict[item] || <span className="merge-window__empty-snippet">No text</span>}</pre></article>)}
        </div>
        <div className="merge-window__conflict-actions" aria-label="Resolve this conflict">
          <button className="button button--quiet" type="button" disabled={props.state === "resolving"} onClick={() => props.onResolveConflict(activeConflict.id, "mine")}>Use mine</button>
          <button className="button button--quiet" type="button" disabled={props.state === "resolving"} onClick={() => props.onResolveConflict(activeConflict.id, "server")}>Use server</button>
          <button className="button button--quiet" type="button" disabled={props.state === "resolving"} onClick={() => props.onResolveConflict(activeConflict.id, "both")}>Use both</button>
        </div>
      </section> : <div className="merge-window__all-resolved"><Check size={28} weight="duotone" aria-hidden="true" /><strong>No overlapping edits</strong><span>Review the merged result before saving.</span></div>}
      <label className="merge-window__result" htmlFor={resultId}><span><strong>Merged result</strong><small>Edit the final text before saving.</small></span><textarea id={resultId} value={props.mergedText} spellCheck={false} onChange={(event) => props.onMergedTextChange(event.target.value)} /></label>
    </div>
  </div>;
}

export function MergeWindow(props: MergeWindowProps) {
  const [versionSource, setVersionSource] = useState<VersionSource>("mine");
  const resolving = props.state === "resolving";
  const unresolvedCount = props.mode === "text" ? props.conflicts.filter((conflict) => conflict.resolution === null).length : 0;

  useEffect(() => {
    if (props.mode !== "text") return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!unresolvedCount && !resolving) props.onSaveMerged();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [props, resolving, unresolvedCount]);

  return <section className="merge-window" aria-label={`Review versions of ${props.mine.name}`} aria-busy={props.state === "loading" || resolving}>
    <header className="merge-window__heading"><div><GitMerge size={24} weight="duotone" aria-hidden="true" /><span><h1>Review versions</h1><p>{props.mine.name}</p></span></div>{props.mode === "text" && <strong className="merge-window__unresolved" data-resolved={!unresolvedCount || undefined}>{unresolvedCount ? `${unresolvedCount} unresolved` : "Ready to save"}</strong>}</header>
    {props.state === "error" ? <div className="merge-window__state" role="alert"><WarningCircle size={30} weight="duotone" /><strong>Versions could not be loaded</strong><span>{props.error || "Try loading the conflict again."}</span>{props.onRetry && <button className="button button--primary" type="button" onClick={props.onRetry}>Try again</button>}</div> : props.state === "loading" ? <div className="merge-window__state" role="status"><SpinnerGap className="merge-window__spinner" size={30} /><strong>Loading both versions...</strong><span>Your local change remains safe.</span></div> : <>
      {resolving && <div className="merge-window__resolving" role="status"><SpinnerGap className="merge-window__spinner" size={17} /> Applying your choice...</div>}
      {props.mode === "text" ? <TextMerge {...props} /> : <div className="merge-window__compare">
        <SourceTabs tabs={["mine", "server"] as const} selected={versionSource} onSelect={setVersionSource} label="File versions" />
        <div className="merge-window__versions">
          {props.mode === "media" ? <><MediaPreview version={props.mine} label="mine" kind={props.mediaKind} active={versionSource === "mine"} /><MediaPreview version={props.server} label="server" kind={props.mediaKind} active={versionSource === "server"} /></> : <><div data-source="mine" data-mobile-active={versionSource === "mine" || undefined}><VersionDetails version={props.mine} label="mine" /></div><div data-source="server" data-mobile-active={versionSource === "server" || undefined}><VersionDetails version={props.server} label="server" /></div></>}
        </div>
      </div>}
    </>}
    <footer className="merge-window__footer">
      <span>{resolving ? "Finishing your choice..." : props.mode === "text" && unresolvedCount ? "Resolve every conflict to save the merged file." : "Choose one version, keep both files, or save the merged result."}</span>
      <div><button className="button button--quiet" type="button" disabled={props.state !== "ready"} onClick={props.onKeepMine}>Keep mine</button><button className="button button--quiet" type="button" disabled={props.state !== "ready"} onClick={props.onKeepServer}>Keep server</button><button className="button button--quiet" type="button" disabled={props.state !== "ready"} onClick={props.onKeepBoth}>Keep both</button>{props.mode === "text" && <button className="button button--primary" type="button" disabled={props.state !== "ready" || unresolvedCount > 0} onClick={props.onSaveMerged}><FloppyDisk size={17} aria-hidden="true" /> Save merged</button>}</div>
    </footer>
  </section>;
}
