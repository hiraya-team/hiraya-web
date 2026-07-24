# `@hiraya/apps-ui`

Framework-neutral UI foundations for sandboxed Hiraya apps.

```ts
import { bindTheme } from "@hiraya/apps-ui";
import "@hiraya/apps-ui/styles.css";

const launch = await hiraya.app.getLaunchContext();
const unsubscribeTheme = bindTheme(hiraya, launch.theme);
```

Add `hiraya-app` to the app's `<body>` to opt into the scoped reset, focus treatment, reduced-motion behavior, and responsive primitives. Available primitives are `hiraya-stack`, `hiraya-cluster`, `hiraya-cluster--collapse`, `hiraya-panel`, and `hiraya-sr-only`. Apps remain responsible for their own visual identity and token fallbacks.
