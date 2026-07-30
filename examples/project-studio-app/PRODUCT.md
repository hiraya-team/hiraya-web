# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19, TypeScript, Vite, CodeMirror 6, and the repository-local Hiraya App SDK and UI runtime. Dependencies are limited to packages already used by the Hiraya frontend.

## Users

Creators and writers working on small Markdown-based publications inside Hiraya. They need a focused tool that remains usable on a phone while expanding into a productive multi-pane desktop window.

## Product Purpose

Project Studio opens or initializes a Hiraya project folder, supports safe multi-document editing and draft preview, and publishes the project as one portable, self-contained HTML file. Success means a user can complete that full workflow without leaving Hiraya or risking silent overwrite of another writer's changes.

## Positioning

Project Studio turns ordinary synchronized Hiraya files into a portable publication while preserving the desktop's capability boundaries, offline behavior, revision safety, and user ownership of every source and output file.

## Operating Context

The app runs in Hiraya's opaque-origin sandbox, receives folder access through an explicit picker, and may be presented as a full-surface touch interface or a resizable desktop window. Projects contain a strict `hiraya.project.json`, Markdown pages, an optional `site.css`, local raster images, and generated `dist/index.html` output.

## Capabilities and Constraints

- Use only brokered Hiraya App SDK services; direct network access, browser storage, OPFS, processes, and package installation are unavailable.
- Folder and file handles are opaque, instance-bound capabilities and cannot restore a project after the app closes.
- File saves must use retained content revisions and preserve local drafts on conflict, timeout, offline, or permission failure.
- App-local storage is limited to small preferences; source documents and published output remain ordinary Hiraya files.
- Publishing produces one self-contained HTML artifact within the host's 32 MiB staged-write limit.
- Multiple pages default to hash-routed navigation inside the single artifact. This remains changeable because the user did not select among the proposed routing models.
- Project Studio ships as an experimental app package, not a privileged system app.

## Evidence on Hand

The repository provides the typed App SDK, schema-2 package tooling, injected app UI runtime, CodeMirror language packages, Markdown rendering packages, reference Text Editor, Markdown Preview, ZIP Browser, and Pixel Editor implementations. No external brand assets or factual publication content were supplied and none should be fabricated as product evidence.

## Product Principles

- Preserve writing before optimizing workflow.
- Keep user projects portable and visible as ordinary files.
- Start with one clear task on mobile and progressively expose workspace density.
- Make offline, read-only, conflict, and locally-saved states explicit.
- Treat previewed project content as untrusted input.

## Accessibility & Inclusion

Meet WCAG AA, retain full keyboard operation, provide visible focus, honor reduced motion and runtime themes, support 200% zoom, and keep primary touch targets at least 44 by 44 CSS pixels.
