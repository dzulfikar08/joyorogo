// Port of `HuaweiExportZip.kt` (`Zip4jExportSource`): the export ZIP over zip.js, which reads the AES-256 encryption the Privacy Centre
// applies with the password the user set. The archive is opened with random access on the picked `File` (the central directory first,
// then one member at a time), so a multi-GB export is never read into memory.

import { BlobReader, configure, ZipReader } from "@zip.js/zip.js";
import type { FileEntry } from "@zip.js/zip.js";

import { ExportReadError } from "./importer";
import type { ExportEntry, ExportSource } from "./importer";
import { ConvertError } from "./types";

// This code already runs in a Worker of its own; zip.js's own workers would need a blob: Worker (CSP) for no gain.
configure({ useWebWorkers: false });

const ERR_INVALID_PASSWORD = "Invalid password";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ZipExportSource extends ExportSource {
  close(): Promise<void>;
}

/**
 * Opens `file` and checks the password against the smallest encrypted member, so a wrong one fails here and not after minutes of work.
 * Throws `ConvertError` (`not_a_zip`, `password_required`, `bad_password`).
 */
export async function openZipSource(
  file: Blob,
  password: string,
  signal?: AbortSignal,
): Promise<ZipExportSource> {
  const zip = new ZipReader(new BlobReader(file), {
    filenameValidation: "tolerant",
    strictness: "tolerant",
  });
  const members = new Map<string, FileEntry>();
  try {
    for (const entry of await zip.getEntries())
      if (!entry.directory) members.set(entry.filename, entry);
  } catch (e) {
    await zip.close().catch(() => {});
    throw new ConvertError("not_a_zip", `The ZIP could not be read: ${messageOf(e)}`);
  }
  let probe: FileEntry | null = null;
  for (const entry of members.values()) {
    if (entry.encrypted && (probe === null || entry.uncompressedSize < probe.uncompressedSize))
      probe = entry;
  }
  if (probe) {
    if (password.length === 0) {
      await zip.close().catch(() => {});
      throw new ConvertError(
        "password_required",
        "This ZIP needs the password you set when you requested the data",
      );
    }
    try {
      await probe.getData(new WritableStream(), { password, checkPasswordOnly: true, signal });
    } catch (e) {
      await zip.close().catch(() => {});
      if (signal?.aborted) throw e;
      if (messageOf(e) === ERR_INVALID_PASSWORD)
        throw new ConvertError("bad_password", "Wrong ZIP password");
      throw new ConvertError("not_a_zip", `The ZIP could not be read: ${messageOf(e)}`);
    }
  }
  return {
    entries: (): ExportEntry[] =>
      [...members.values()].map((e) => ({ name: e.filename, size: e.uncompressedSize })),
    async read(entry, onChunk) {
      const member = members.get(entry.name);
      if (!member) throw new ExportReadError(`No such entry: ${entry.name}`);
      // An error of the caller (a cancel, a bug) must reach it as it is; only the archive's own errors are "this file is damaged".
      let callbackFailed = false;
      let callbackError: unknown;
      const sink = new WritableStream<Uint8Array>({
        async write(chunk) {
          try {
            await onChunk(chunk);
          } catch (e) {
            callbackFailed = true;
            callbackError = e;
            throw e;
          }
        },
      });
      try {
        await member.getData(sink, { password, signal, checkCrc32: true });
      } catch (e) {
        if (callbackFailed) throw callbackError;
        if (signal?.aborted) throw e;
        throw new ExportReadError(messageOf(e));
      }
    },
    close: () => zip.close(),
  };
}
