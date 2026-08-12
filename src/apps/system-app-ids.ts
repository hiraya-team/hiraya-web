export const SYSTEM_APP_IDS = {
  textEditor: "app.hiraya.text-editor",
  imageViewer: "app.hiraya.image-viewer",
  mediaViewer: "app.hiraya.media-viewer",
  fileViewer: "app.hiraya.file-viewer",
  terminal: "app.hiraya.terminal",
  themeEditor: "app.hiraya.theme-editor",
} as const;

export const RESERVED_SYSTEM_APP_IDS: ReadonlySet<string> = new Set(Object.values(SYSTEM_APP_IDS));
