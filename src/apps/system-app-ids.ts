export const SYSTEM_APP_IDS = {
  textEditor: "app.hiraya.text-editor",
  markdownPreview: "app.hiraya.markdown-preview",
  imageViewer: "app.hiraya.image-viewer",
  mediaViewer: "app.hiraya.media-viewer",
  fileViewer: "app.hiraya.file-viewer",
  terminal: "app.hiraya.terminal",
  themeEditor: "app.hiraya.theme-editor",
  sceneEditor: "app.hiraya.scene-editor",
} as const;

export const RETIRED_SYSTEM_APP_IDS = {
  markdownPreview: SYSTEM_APP_IDS.markdownPreview,
  sceneEditor: SYSTEM_APP_IDS.sceneEditor,
} as const;

export const ACTIVE_SYSTEM_APP_IDS = {
  textEditor: SYSTEM_APP_IDS.textEditor,
  imageViewer: SYSTEM_APP_IDS.imageViewer,
  mediaViewer: SYSTEM_APP_IDS.mediaViewer,
  fileViewer: SYSTEM_APP_IDS.fileViewer,
  terminal: SYSTEM_APP_IDS.terminal,
  themeEditor: SYSTEM_APP_IDS.themeEditor,
} as const;

export const RESERVED_SYSTEM_APP_IDS: ReadonlySet<string> = new Set([
  ...Object.values(ACTIVE_SYSTEM_APP_IDS),
  ...Object.values(RETIRED_SYSTEM_APP_IDS),
]);
