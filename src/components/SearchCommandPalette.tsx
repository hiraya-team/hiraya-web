import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { File, Folder, MagnifyingGlass, Package, SquaresFour, TerminalWindow, X } from "@phosphor-icons/react";
import type { DesktopEntry } from "../types";
import { filterAndGroupSearchItems, selectedRenderedItem, type SearchCategory, type SearchItem } from "../ui/panel-data";
import { useNativeDialog } from "../ui/modal-dialog";
import type { CommandId, CommandItem } from "../apps/commands";
import type { DesktopSearchResponse, DesktopSearchResult } from "../lib/search";
import { indexSearchBreadcrumbs } from "../ui/search-breadcrumbs";

export type SearchPaletteWindow = {
  id: string;
  title: string;
  detail?: string;
};

export type SearchPaletteApp = {
  id: string;
  name: string;
  description?: string;
  source: "system" | "desktop" | "store" | "account";
  fileTypes?: readonly string[];
  available: boolean;
};

export type SearchCommandPaletteProps<Id extends CommandId> = {
  entries: readonly DesktopEntry[];
  activeDesktopId: string;
  activeDesktopName: string;
  activeAuthorityCatalogId: string | null;
  cachedDesktopResults: readonly DesktopSearchResult[];
  searchAllDesktops: boolean;
  allDesktopsAvailable: boolean;
  online: boolean;
  onSearchAllDesktops: (query: string, signal: AbortSignal) => Promise<DesktopSearchResponse>;
  onSearchAllDesktopsChange: (enabled: boolean) => void;
  apps: readonly SearchPaletteApp[];
  windows: readonly SearchPaletteWindow[];
  commands: readonly CommandItem<Id>[];
  onOpenEntry: (result: DesktopSearchResult) => void;
  onLaunchApp: (appId: string) => void;
  onFocusWindow: (windowId: string) => void;
  onRunCommand: (commandId: Id) => void;
  onClose: () => void;
};

type PaletteItem = SearchItem & { action: () => void; disabled?: boolean };

const CATEGORY_LABELS: Record<SearchCategory, string> = {
  apps: "Apps",
  files: "Files",
  folders: "Folders",
  windows: "Open windows",
  commands: "Commands",
};

function ResultIcon({ category }: { category: SearchCategory }) {
  if (category === "apps") return <Package size={18} weight="duotone" aria-hidden="true" />;
  if (category === "files") return <File size={18} weight="duotone" aria-hidden="true" />;
  if (category === "folders") return <Folder size={18} weight="duotone" aria-hidden="true" />;
  if (category === "windows") return <SquaresFour size={18} weight="duotone" aria-hidden="true" />;
  return <TerminalWindow size={18} weight="duotone" aria-hidden="true" />;
}

export function SearchCommandPalette<Id extends CommandId>({ entries, activeDesktopId, activeDesktopName, activeAuthorityCatalogId, cachedDesktopResults, searchAllDesktops, allDesktopsAvailable, online, onSearchAllDesktops, onSearchAllDesktopsChange, apps, windows, commands, onOpenEntry, onLaunchApp, onFocusWindow, onRunCommand, onClose }: SearchCommandPaletteProps<Id>) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [activeIndex, setActiveIndex] = useState(0);
  const [remoteResponse, setRemoteResponse] = useState<DesktopSearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchGenerationRef = useRef(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const queryRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const queryLabelId = useId();
  const listId = useId();
  const scopeStatusId = useId();
  const breadcrumbs = useMemo(() => indexSearchBreadcrumbs(entries), [entries]);
  useNativeDialog(dialogRef, onClose);

  useEffect(() => {
    const generation = ++searchGenerationRef.current;
    setRemoteResponse(null);
    setSearchError("");
    setSearching(false);
    if (!searchAllDesktops || !allDesktopsAvailable || !online || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void onSearchAllDesktops(query.trim(), controller.signal)
        .then((response) => {
          if (searchGenerationRef.current === generation) setRemoteResponse(response);
        })
        .catch((error) => {
          if (!controller.signal.aborted && searchGenerationRef.current === generation) setSearchError(error instanceof Error ? error.message : "Search could not be completed.");
        })
        .finally(() => {
          if (!controller.signal.aborted && searchGenerationRef.current === generation) setSearching(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [allDesktopsAvailable, online, onSearchAllDesktops, query, searchAllDesktops]);

  const activeResults: DesktopSearchResult[] = entries.map((entry) => ({
    authorityCatalogId: activeAuthorityCatalogId,
    catalogRevision: null,
    desktopId: activeDesktopId,
    desktopName: activeDesktopName,
    entry,
    breadcrumb: breadcrumbs.get(entry.id) ?? [],
    stale: false,
  }));
  const desktopResults = searchAllDesktops ? (remoteResponse ? [...remoteResponse.results.filter((result) => result.desktopId !== activeDesktopId || result.authorityCatalogId !== activeAuthorityCatalogId), ...activeResults] : [...cachedDesktopResults.filter((result) => result.desktopId !== activeDesktopId || result.authorityCatalogId !== activeAuthorityCatalogId), ...activeResults]) : activeResults;

  const items: PaletteItem[] = [
    ...apps.map((app): PaletteItem => ({
      id: `app:${app.id}`,
      category: "apps",
      label: app.name,
      detail: app.available
        ? [app.source === "system" ? "Bundled system app" : app.source === "account" ? "Synchronized account app" : app.source === "store" ? "Store app" : "Desktop app", app.description].filter(Boolean).join(" · ")
        : "Desktop app · Package unavailable",
      keywords: [app.id, app.source, ...(app.fileTypes ?? [])],
      disabled: !app.available,
      action: () => onLaunchApp(app.id),
    })),
    ...desktopResults.map((result): PaletteItem => ({
      id: `entry:${result.authorityCatalogId ?? "local"}:${result.desktopId}:${result.entry.id}`,
      category: result.entry.kind === "file" ? "files" : "folders",
      label: result.entry.name,
      detail: `${result.desktopName} · ${result.breadcrumb.length ? result.breadcrumb.join(" / ") : "Desktop"} · ${result.entry.kind === "file" ? result.entry.mimeType : "Folder"}${result.stale ? " · Cached, may be stale" : ""}`,
      keywords: [result.desktopName, ...result.breadcrumb, result.entry.kind, result.entry.kind === "file" ? result.entry.mimeType : "folder"],
      action: () => onOpenEntry(result),
    })),
    ...windows.map((window): PaletteItem => ({
      id: `window:${window.id}`,
      category: "windows",
      label: window.title,
      detail: window.detail,
      action: () => onFocusWindow(window.id),
    })),
    ...commands.map((command): PaletteItem => ({
      id: `command:${command.id}`,
      category: "commands",
      label: command.label,
      detail: command.enabled ? command.detail : [command.detail, "Unavailable in the current desktop state."].filter(Boolean).join(" "),
      keywords: command.keywords,
      disabled: !command.enabled,
      action: () => onRunCommand(command.id),
    })),
  ];
  const suggestedItems = deferredQuery ? items : [...items.filter((item) => item.category === "apps").slice(0, 5), ...items.filter((item) => item.category === "windows"), ...items.filter((item) => item.category === "files" || item.category === "folders").slice(0, 5), ...items.filter((item) => item.category === "commands")];
  const groups = filterAndGroupSearchItems(suggestedItems, deferredQuery);
  const results = groups.flatMap((group) => group.items);
  const selectedIndex = results.length === 0 ? -1 : Math.min(activeIndex, results.length - 1);
  const selectedId = selectedIndex >= 0 ? `${listId}-option-${selectedIndex}` : undefined;

  function choose(item: PaletteItem) {
    if (item.disabled) return;
    onClose();
    item.action();
  }

  function selectSearchMode(allDesktops: boolean) {
    setActiveIndex(0);
    onSearchAllDesktopsChange(allDesktops);
    queryRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (Math.min(index, results.length - 1) + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (Math.min(index, results.length - 1) - 1 + results.length) % results.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(results.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = selectedRenderedItem(results, activeIndex);
      if (selected) choose(selected);
    }
  }

  let resultIndex = 0;
  return (
    <dialog ref={dialogRef} className="modal-backdrop command-palette-backdrop" aria-labelledby={titleId} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="file-window command-palette">
        <header className="window-header">
          <div><span className="window-kicker">Hiraya</span><h2 id={titleId}>Search</h2></div>
          <button className="icon-button" type="button" aria-label="Close search" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="command-palette__search">
          <MagnifyingGlass size={20} aria-hidden="true" />
          <label className="sr-only" htmlFor={`${titleId}-query`} id={queryLabelId}>
            Search apps, files, folders, windows, and commands
          </label>
          <input
            ref={queryRef}
            id={`${titleId}-query`}
            type="search"
            role="combobox"
            value={query}
            placeholder="Search Hiraya"
            autoComplete="off"
            autoFocus
            data-dialog-autofocus
            aria-autocomplete="list"
            aria-expanded="true"
            aria-haspopup="listbox"
            aria-controls={listId}
            aria-activedescendant={selectedId}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="command-palette__scope">
          <div className="command-palette__segments" role="group" aria-label="Search scope">
            <button type="button" aria-pressed={!searchAllDesktops} onClick={() => selectSearchMode(false)}>
              Current
            </button>
            <button type="button" aria-pressed={searchAllDesktops} disabled={!allDesktopsAvailable} aria-describedby={scopeStatusId} title={!allDesktopsAvailable ? "This server does not provide search across desktops." : undefined} onClick={() => selectSearchMode(true)}>
              All desktops
            </button>
          </div>
          <span id={scopeStatusId} role="status">
            {!allDesktopsAvailable ? "Search across desktops is unavailable on this server." : searching ? "Searching server..." : searchAllDesktops && !online ? "Offline: cached results may be stale." : searchAllDesktops && remoteResponse?.truncated ? `Showing the first ${remoteResponse.limit} server results, merged with this live desktop.` : searchAllDesktops && remoteResponse ? "Server results, merged with this live desktop." : "This desktop is searched live."}
          </span>
        </div>
        {searchError && (
          <p className="command-palette__warning" role="alert">
            {searchError} Showing cached results, which may be stale.
          </p>
        )}
        <div id={listId} className="command-palette__results" role="listbox" aria-label="Search results">
          {groups.length === 0 ? (
            <div className="command-palette__empty" role="option" aria-disabled="true" aria-selected="false">
              <MagnifyingGlass size={28} weight="duotone" aria-hidden="true" />
              <strong>{query ? "No results found" : "Nothing to suggest yet"}</strong>
              <span>{query ? "Try an app, file, window, or command." : "Apps, current windows, recent files, and commands appear here."}</span>
            </div>
          ) : (
            groups.map((group) => (
              <section className="command-palette__group" role="group" aria-label={CATEGORY_LABELS[group.category]} key={group.category}>
                <h2 aria-hidden="true">{CATEGORY_LABELS[group.category]}</h2>
                {group.items.map((item) => {
                  const index = resultIndex++;
                  const detailId = item.detail ? `${listId}-option-${index}-detail` : undefined;
                  return (
                    <button id={`${listId}-option-${index}`} className="command-palette__result" type="button" role="option" aria-selected={index === selectedIndex} aria-disabled={item.disabled || undefined} aria-describedby={detailId} disabled={item.disabled} data-active={index === selectedIndex || undefined} key={item.id} onPointerMove={() => setActiveIndex(index)} onClick={() => choose(item)}>
                      <ResultIcon category={item.category} />
                      <span>
                        <strong>{item.label}</strong>
                        {item.detail && <small id={detailId}>{item.detail}</small>}
                      </span>
                    </button>
                  );
                })}
              </section>
            ))
          )}
        </div>
      </section>
    </dialog>
  );
}
