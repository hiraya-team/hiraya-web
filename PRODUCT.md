# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People using a self-hosted Hiraya desktop to spatially organize files, personalize shared desktops, and publish read-only desktops.

## Product Purpose

Hiraya is a local-first browser desktop whose server is authoritative when synchronization is enabled. A desktop owns its files, hierarchy, layout, appearance, sharing, and permissions.

## Positioning

Hiraya combines a spatial desktop interaction model with synchronized, server-authoritative files and appearance that remain usable through short outages.

## Operating Context

Hiraya runs as an installable PWA or browser tab. Users open files and `.hiraya.app` packages from the desktop, customize appearance in Settings, and may publish a desktop for anonymous read-only access.

## Capabilities and Constraints

- `.hiraya.app` packages may contain sandboxed apps or importable themes.
- Importing a theme applies it to the current desktop; there is no separate installed-theme package manager.
- Theme packages may include static, animated, or sandboxed executable wallpaper scenes.
- Packaged wallpaper assets are hidden, synchronized desktop resources owned by the imported custom theme and cleaned up with it.
- Wallpaper scenes have no Hiraya host API, file access, network access, or pointer interaction.
- Public desktops run the selected scene for anonymous visitors.
- Animated and scene wallpapers may omit a poster; reduced-motion and failure states use the built-in Hiraya Dusk wallpaper.
- The original visible package file is independent of the imported hidden resource.
- The server remains authoritative in synchronized mode; browser OPFS is a cache and projected offline desktop.

## Brand Commitments

Preserve the Hiraya name, dusk-green wallpaper, amber accent, translucent menu bar, restrained desktop chrome, Phosphor icons, and familiar desktop interaction model.

## Evidence on Hand

The repository contains the production React desktop, strict app package parser and sandbox, custom theme editor, wallpaper controls, public desktop renderer, synchronized Go API, durable blob storage, and operational backup and migration paths.

## Product Principles

- Keep desktop behavior familiar and predictable.
- Validate untrusted packages before any state becomes visible.
- Persist bytes before metadata and publish synchronized changes only after commit.
- Keep package execution isolated and capabilities explicit.
- Preserve accessibility, including keyboard operation and reduced-motion behavior.

## Accessibility & Inclusion

Meet WCAG AA contrast, preserve keyboard and Escape behavior, keep controls usable at mobile widths, and never run animated or executable wallpaper when `prefers-reduced-motion` is active.
