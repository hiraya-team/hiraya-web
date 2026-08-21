export type SaveFileOptions = {
  mimeType?: string;
  expectedContentRevision?: number;
  unconditional?: boolean;
};

/** Identifies a write rejected because file content changed concurrently. */
export class ContentRevisionConflictError extends Error {
  /** Records the expected and observed content revisions. */
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super("The file changed since it was last read.");
    this.name = "ContentRevisionConflictError";
  }
}
