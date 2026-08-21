import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ShellNotifications } from "../src/features/notifications/ShellNotifications";

/** Provides the base props test fixture. */
const baseProps = {
  syncIssue: null,
  syncIssueLabels: [],
  messages: [],
  trashNotifications: [],
  appNotifications: [],
  importProgress: null,
  showUpdateToast: false,
  updateApplying: false,
  updateBlocked: false,
  announcement: "",
  canViewActivity: false,
  open: false,
  onOpenChange: () => undefined,
  onRetrySyncIssue: () => undefined,
  onDiscardSyncIssue: () => undefined,
  onDismissMessage: () => undefined,
  onOpenFolderImportHelp: () => undefined,
  onDismissTrash: () => undefined,
  onUndoTrash: () => undefined,
  onOpenTrash: () => undefined,
  onDismissApp: () => undefined,
  onDismissTransfer: () => undefined,
  onActivateUpdate: () => undefined,
  onDismissUpdate: () => undefined,
  onViewActivity: () => undefined,
};

test("shows copy-specific progress while uncached content downloads", () => {
  const markup = renderToStaticMarkup(<ShellNotifications
    {...baseProps}
    copyDownload={{ entryIds: new Set(["file-1"]), totalBytes: 10 }}
    fileTransfers={[{ id: "download:1", entryId: "file-1", fileName: "notes.txt", direction: "download", phase: "downloading", transferredBytes: 4, totalBytes: 10, error: null }]}
  />);

  expect(markup).toContain("Downloading file before copy");
  expect(markup).toContain('aria-label="Copy download progress"');
  expect(markup).toContain('value="4"');
  expect(markup).toContain('max="10"');
});

test("keeps copy progress compact on mobile", async () => {
  const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();
  expect(css).toContain(".copy-download-progress > span { display: none; }");
});
