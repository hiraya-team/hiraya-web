# Style Ownership

Hiraya keeps one order-sensitive legacy desktop cascade while features are gradually isolated. Do not reorder or wrap `src/styles.css` wholesale.

- `index.css` owns import order only: foundation first, desktop cascade second.
- `foundation.css` owns document defaults, reset rules, focus defaults, and stable radius, touch-target, and systemic z-index tokens.
- `styles.css` owns desktop shell, feature visuals, responsive overrides, runtime theme projection, and reduced-motion fallbacks. Keep a feature's base, responsive, and motion rules adjacent when adding new sections.
- Component files own dynamic geometry and theme values only when CSS cannot express them. They must not introduce a second global token source.

New standalone features may move to a dedicated stylesheet only when it is imported from `index.css` at an explicitly documented position and has no hidden dependency on later legacy selectors.
