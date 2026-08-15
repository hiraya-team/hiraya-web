import type { ComponentProps } from "@solidjs/web";

export type ControlProps = ComponentProps<"button">;

export function Control(props: ControlProps) {
  return <button {...props} class={`control${props.class ? ` ${props.class}` : ""}`} type={props.type ?? "button"} />;
}
