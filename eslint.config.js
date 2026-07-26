import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["packages/app-cli/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["src/PublicDesktop.tsx", "src/lib/public-desktop.ts", "src/ui/public-desktop-layout.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/sync", "**/opfs", "**/outbox", "**/apps/host", "**/apps/host/**"],
              message: "The public desktop must remain independent of authenticated storage, synchronization, outbox, and app-host modules.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react/**", "../components/**", "../ui/**", "../lib/**", "../apps/**", "../platform/**"],
              message: "Domain contracts must remain independent of React, UI, features, and platform implementations.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/opfs*.{ts,tsx}", "src/platform/storage/**/*.{ts,tsx}", "src/apps/host/**/*.{ts,tsx}", "packages/app-runtime/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/ui/**", "**/components/**"],
              message: "Persistence and app-host implementations must not depend on UI modules.",
            },
            {
              group: ["**/lib/opfs"],
              message: "App-host services must depend on neutral domain ports rather than the OPFS implementation.",
            },
            {
              group: ["@hiraya/app-cli"],
              message: "The app runtime must depend on package contracts rather than CLI implementation types.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/platform/sync/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/ui/**", "**/components/**", "**/App", "**/PublicDesktop"],
              message: "Synchronization platform modules must remain independent of React UI and composition roots.",
            },
          ],
        },
      ],
    },
  },
);
