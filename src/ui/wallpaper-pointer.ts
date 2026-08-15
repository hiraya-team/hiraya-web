import type { SandboxPointerObservation } from "@hiraya/app-runtime/navigation";

export type WallpaperSceneTarget = { frame: HTMLIFrameElement; token: string };

export function desktopPointerObservation(event: Pick<MouseEvent, "altKey" | "button" | "buttons" | "clientX" | "clientY" | "ctrlKey" | "metaKey" | "shiftKey"> & Partial<Pick<PointerEvent, "pointerId" | "pointerType">>, desktop: HTMLElement, phase: SandboxPointerObservation["phase"]): SandboxPointerObservation {
  const bounds = desktop.getBoundingClientRect();
  return { phase, x: event.clientX - bounds.left, y: event.clientY - bounds.top, button: event.button, buttons: event.buttons, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, pointerId: event.pointerId ?? 0, pointerType: event.pointerType ?? "mouse" };
}

export function projectSandboxPointer(observation: SandboxPointerObservation, frame: HTMLIFrameElement, desktop: HTMLElement): SandboxPointerObservation {
  const frameBounds = frame.getBoundingClientRect();
  const desktopBounds = desktop.getBoundingClientRect();
  return { ...observation, x: frameBounds.left + observation.x - desktopBounds.left, y: frameBounds.top + observation.y - desktopBounds.top };
}
