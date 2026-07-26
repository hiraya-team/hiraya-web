export type SaveFileOptions = {
  mimeType?: string;
  expectedContentRevision?: number;
};

export class ContentRevisionConflictError extends Error {
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super("The file changed since it was last read.");
    this.name = "ContentRevisionConflictError";
  }
}
