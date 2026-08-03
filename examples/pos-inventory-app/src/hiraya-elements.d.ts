import type { DetailedHTMLProps, HTMLAttributes } from "react";

type HirayaElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "hiraya-badge": HirayaElement & { tone?: "neutral" | "accent" | "danger" | "progress" | "readonly" };
      "hiraya-button": HirayaElement & { disabled?: boolean; loading?: boolean; variant?: "secondary" | "primary" | "quiet" | "danger" };
      "hiraya-dialog": HirayaElement & { open?: boolean; "close-label"?: string };
      "hiraya-empty-state": HirayaElement;
      "hiraya-notice": HirayaElement & { live?: "polite" | "assertive"; tone?: "neutral" | "accent" | "danger" };
      "hiraya-status-bar": HirayaElement & { live?: "polite" | "assertive"; tone?: "neutral" | "accent" | "danger" };
    }
  }
}
