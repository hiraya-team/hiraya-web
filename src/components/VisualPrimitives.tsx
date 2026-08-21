import {
  CloudCheck,
  CloudSlash,
  CircleHalf,
  File as FileGlyph,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FilePdf,
  FileText,
  FileVideo,
  Folder,
  GearSix,
  GitMerge,
  Info,
  LinkSimple,
  HardDrive,
  Package,
  SpinnerGap,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DesktopEntry } from "../types";
import { fileCapabilities } from "../ui/file-capabilities";
import { offlineStatusLabel, type OfflineEntryAvailability } from "../lib/offline-availability";

/** Renders the entry icon interface. */
export function EntryIcon({ entry, size = 24 }: { entry: DesktopEntry; size?: number }) {
  if (entry.kind === "folder") return <Folder size={size} weight="duotone" aria-hidden="true" />;
  const { icon } = fileCapabilities(entry);
  const props = { size, weight: "duotone" as const, "aria-hidden": true };
  if (icon === "app") return <Package {...props} />;
  if (icon === "image") return <FileImage {...props} />;
  if (icon === "video") return <FileVideo {...props} />;
  if (icon === "audio") return <FileAudio {...props} />;
  if (icon === "pdf") return <FilePdf {...props} />;
  if (icon === "archive") return <FileArchive {...props} />;
  if (icon === "url") return <LinkSimple {...props} />;
  if (icon === "code") return <FileCode {...props} />;
  if (icon === "text") return <FileText {...props} />;
  return <FileGlyph {...props} />;
}

export type EntryPreviewSource = Readonly<{ kind: "blob"; blob: Blob }> | Readonly<{ kind: "url"; url: string }>;

/** Renders the media thumbnail interface. */
function MediaThumbnail({ entry, size, loadPreview }: { entry: Extract<DesktopEntry, { kind: "file" }>; size: number; loadPreview: (id: string) => Promise<EntryPreviewSource> }) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const target = triggerRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(([result]) => {
      if (!result?.isIntersecting) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { rootMargin: "120px" });
    observer.observe(target);
    // Chromium can miss the initial intersection for a newly inserted folder row until its first layout.
    const frame = requestAnimationFrame(() => {
      const bounds = target.getBoundingClientRect();
      if (bounds.bottom >= -120 && bounds.right >= -120 && bounds.top <= innerHeight + 120 && bounds.left <= innerWidth + 120) {
        setShouldLoad(true);
        observer.disconnect();
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!shouldLoad) return;
    let active = true;
    let objectUrl: string | null = null;
    setSource(null);
    setLoaded(false);
    void loadPreview(entry.id).then((preview) => {
      const next = preview.kind === "blob" ? URL.createObjectURL(preview.blob) : preview.url;
      if (!active) {
        if (preview.kind === "blob") URL.revokeObjectURL(next);
        return;
      }
      objectUrl = preview.kind === "blob" ? next : null;
      setSource(next);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entry.id, entry.mimeType, entry.modifiedAt, entry.size, loadPreview, shouldLoad]);

  return <>
    <EntryIcon entry={entry} size={size} />
    <span ref={triggerRef} className="entry-thumbnail-trigger" aria-hidden="true" />
    {source && <img className="entry-thumbnail" src={source} alt="" aria-hidden="true" loading="lazy" decoding="async" draggable={false} data-loaded={loaded || undefined} onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} />}
  </>;
}

/** Renders the entry artwork interface. */
export function EntryArtwork({ entry, size = 24, loadPreview }: { entry: DesktopEntry; size?: number; loadPreview?: (id: string) => Promise<EntryPreviewSource> }) {
  if (entry.kind === "file" && ["image", "video"].includes(fileCapabilities(entry).preview) && loadPreview) return <MediaThumbnail entry={entry} size={size} loadPreview={loadPreview} />;
  return <EntryIcon entry={entry} size={size} />;
}

/** Renders the app icon interface. */
export function AppIcon({ kind, entry, size = 16 }: { kind: "file" | "explorer" | "properties" | "settings" | "sandbox" | "store" | "merge"; entry?: DesktopEntry | null; size?: number }) {
  if (kind === "file" && entry) return <EntryIcon entry={entry} size={size} />;
  if (kind === "explorer") return <Folder size={size} weight="duotone" aria-hidden="true" />;
  if (kind === "properties") return <Info size={size} aria-hidden="true" />;
  if (kind === "merge") return <GitMerge size={size} aria-hidden="true" />;
  if (kind === "sandbox" || kind === "store") return <Package size={size} aria-hidden="true" />;
  return <GearSix size={size} aria-hidden="true" />;
}

/** Renders the availability badge interface. */
export function AvailabilityBadge({ availability }: { availability: OfflineEntryAvailability }) {
  return <span className="availability-badge" data-status={availability.status} title={offlineStatusLabel(availability)} aria-label={offlineStatusLabel(availability)}>
    {availability.status === "local" ? <HardDrive /> : availability.status === "updating" ? <SpinnerGap /> : availability.status === "online-only" ? <CloudSlash /> : availability.status === "partial" ? <CircleHalf /> : availability.status === "empty" ? <Folder /> : <CloudCheck />}
  </span>;
}

export type StatusTone = "neutral" | "success" | "danger" | "progress" | "readonly";

/** Renders the status badge interface. */
export function StatusBadge({ children, tone = "neutral", surface = "window" }: { children: ReactNode; tone?: StatusTone; surface?: "window" | "chrome" }) {
  return <span className="status-badge" data-tone={tone} data-surface={surface}>{children}</span>;
}

/** Renders the role badge interface. */
export function RoleBadge({ children }: { children: ReactNode }) {
  return <span className="role-badge">{children}</span>;
}
