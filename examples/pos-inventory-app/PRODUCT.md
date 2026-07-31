# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19, TypeScript, Vite, and the repository-local Hiraya Apps SDK.

## Users

Cashiers and owner-operators running one small-store register from a Hiraya desktop.

## Product Purpose

Hiraya POS records manual-tender sales, updates stock atomically, and keeps the catalog, inventory movements, and receipt history in one portable Hiraya file.

## Positioning

Hiraya POS is a focused offline-capable register for stores that need clear stock control without payment processors, external services, or hidden application databases.

## Operating Context

The app runs in Hiraya's opaque-origin sandbox as a resizable desktop window or narrow touch surface. A `.hpos` file grants the app access to one store; users can launch that file directly or choose it after opening the app.

## Capabilities and Constraints

- One register writes one store file at a time.
- Checkout records cash, card, or other tender but does not process payments.
- Prices are final charged amounts; tax calculation is out of scope.
- Products are found by name or SKU.
- Inventory includes opening stock, receiving, manual removal, reorder levels, and sale deductions.
- The SDK provides revision-safe files but no database or multi-file transactions, so one schema-versioned file is the atomic unit.
- Online payments, receipt printing, barcode capture, suppliers, purchase orders, refunds, multiple registers, and multiple locations are out of scope.
- Hiraya POS ships as an experimental app package, not a privileged system app.

## Product Principles

- Keep the current sale unmistakably primary.
- Never complete a sale unless its stock deduction is in the same committed write.
- Preserve the cart and explain recovery when the store file changes or a write is uncertain.
- Keep completed receipts immutable and products referenced by sales archivable rather than deletable.
- Store money as integer minor units.

## Accessibility & Inclusion

Meet WCAG AA, retain complete keyboard operation, show visible focus, support 200% zoom, honor reduced motion, and keep primary touch targets at least 44 by 44 CSS pixels.
