import { filesystemDatabaseName, openFilesystemDatabase, type FilesystemDatabaseEnvironment } from "../../filesystem/database";
import { getAccountOpfsRoot } from "../../filesystem/chunks";
import { parseSha256, sha256Hex } from "../../filesystem/model";

const DIRECTORY = "approved-package-archives";
const work = new Map<string, Promise<void>>();

export type ApprovedPackageArchiveEnvironment = FilesystemDatabaseEnvironment & {
  originRoot?: FileSystemDirectoryHandle;
  locks?: Pick<LockManager, "request">;
};

export type ApprovedPackageArchives = {
  save(digest: string, archive: Blob, retain?: () => Promise<void>): Promise<void>;
  read(digest: string): Promise<Blob>;
  release(digest: string): Promise<void>;
  close(): void;
};

function isNotFound(error: unknown) {
  return error instanceof DOMException && error.name === "NotFoundError";
}

async function verify(digest: string, archive: Blob) {
  if (archive.size === 0 || await sha256Hex(await archive.arrayBuffer()) !== digest) throw new Error("Approved package archive does not match its digest.");
}

export async function openApprovedPackageArchives(accountId: string, environment: ApprovedPackageArchiveEnvironment = {}): Promise<ApprovedPackageArchives> {
  const database = await openFilesystemDatabase(accountId, environment);
  const directory = await (await getAccountOpfsRoot(accountId, environment.originRoot)).getDirectoryHandle(DIRECTORY, { create: true });
  const lockName = `${await filesystemDatabaseName(accountId)}-package-archives`;
  const locks = environment.locks ?? (typeof navigator === "undefined" ? undefined : navigator.locks);
  const locked = <T>(operation: () => Promise<T>) => {
    const run = () => locks?.request ? locks.request(lockName, operation) : operation();
    const next = (work.get(lockName) ?? Promise.resolve()).then(run, run);
    work.set(lockName, next.then(() => undefined, () => undefined));
    return next;
  };
  const read = async (digestValue: string) => {
    const digest = parseSha256(digestValue, "Approved package digest is invalid.");
    const archive = await (await directory.getFileHandle(digest)).getFile();
    await verify(digest, archive);
    return archive;
  };

  return {
    save: (digestValue, archive, retain) => locked(async () => {
      const digest = parseSha256(digestValue, "Approved package digest is invalid.");
      if (!(archive instanceof Blob)) throw new TypeError("Approved package archive must be a Blob.");
      await verify(digest, archive);
      const writable = await (await directory.getFileHandle(digest, { create: true })).createWritable();
      await writable.write(archive);
      await writable.close();
      await read(digest);
      await retain?.();
    }),
    read,
    release: (digestValue) => locked(async () => {
      const digest = parseSha256(digestValue, "Approved package digest is invalid.");
      const [installed, account] = await Promise.all([database.listInstalledApps(), database.readAccountApps()]);
      if (installed.some((app) => app.digest === digest)
        || account.state.baseline?.apps.some((app) => app.package.sha256 === digest)
        || account.outbox.some((record) => record.operation.kind === "install" && record.operation.digest === digest)) return;
      try {
        await directory.removeEntry(digest);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }),
    close: () => database.close(),
  };
}
