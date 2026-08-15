# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People preparing to use a self-hosted, local-first Hiraya workspace in a current Chromium browser.

## Product Purpose

Hiraya is rebuilding its browser workspace around independent durable file records and selective synchronization. The current milestone proves a small installable shell, required storage capabilities, and safe offline startup before any file data is created.

## Positioning

Hiraya treats offline durability as the foundation rather than a fallback. This build is intentionally a foundation shell, not the previous desktop product.

## Capabilities and Constraints

- Starts as a SolidJS shell in current Chromium.
- Reports unsupported browser storage capabilities explicitly.
- Reloads offline after one successful online load.
- Keeps API and server routes out of service-worker caches.
- Contains no application platform, public desktop, sharing, editor, viewer, themes, widgets, or legacy data compatibility.
- Does not create or inspect browser workspace storage yet.

## Brand Commitments

Preserve the Hiraya name, dusk-green environment, amber accent, restrained chrome, familiar controls, and direct language.

## Product Principles

- Durable local work comes before broad features.
- Never imply data exists before it is committed.
- Keep network and cache authority explicit.
- Prefer browser-native controls and capabilities.
- Make unavailable states exact and actionable.

## Accessibility & Inclusion

Meet WCAG AA contrast, preserve keyboard operation and visible focus, provide approximately 44-pixel targets, support 200% zoom and narrow screens, and honor reduced-motion and forced-color preferences.
