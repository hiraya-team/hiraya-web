# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19, TypeScript, Vite, and the repository-local Hiraya App SDK and injected UI runtime. No packages outside the existing frontend workspace are required.

## Users

People working inside Hiraya who need a small, dependable task list that remains an ordinary portable file.

## Product Purpose

Todo creates, opens, edits, and safely saves focused task lists as `.hiraya.todo` documents. Success means users can track title, completion, optional due date, and priority without losing drafts when access or the underlying file changes.

## Operating Context

Todo runs as an experimental sandboxed Hiraya app in a resizable desktop window or a full-surface mobile view. Launcher opens begin with an unsaved list; file launches validate and open the supplied document.

## Capabilities and Constraints

- Documents use strict schema version 1 and MIME type `application/vnd.hiraya.todo+json`.
- File access is brokered through opaque Hiraya handles; saves use retained content revisions.
- Dirty drafts survive external changes, failed saves, offline states, and lost write permission.
- Conflicts offer explicit **Use remote**, **Save copy**, and **Replace remote** actions.
- The app requests only file read/write, dialogs, window, commands, and theme permissions.

## Product Principles

- Preserve the draft before resolving storage state.
- Keep every common task operation visible and native.
- Make saved, dirty, read-only, conflict, and failure states explicit.
- Reject malformed documents before showing any of their content.

## Accessibility & Inclusion

Meet WCAG AA, preserve keyboard saving and visible focus, honor reduced motion, support 200% zoom, and keep touch controls at least 44 CSS pixels where space permits.
