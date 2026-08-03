import type { DetailedHTMLProps, HTMLAttributes } from "react";

type HirayaElementProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  disabled?: boolean;
  loading?: boolean;
  live?: "polite" | "assertive";
  tone?: "neutral" | "accent" | "danger" | "readonly" | "progress";
  variant?: "secondary" | "primary" | "quiet" | "danger";
  wrap?: boolean;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "hiraya-badge": HirayaElementProps;
      "hiraya-button": HirayaElementProps;
      "hiraya-empty-state": HirayaElementProps;
      "hiraya-notice": HirayaElementProps;
      "hiraya-panel": HirayaElementProps;
      "hiraya-status-bar": HirayaElementProps;
      "hiraya-toolbar": HirayaElementProps & { label?: string };
    }
  }
}
