// The whole conversion, in one async function: the picked ZIP (random access, one member at a time) through the parsers into the import
// file (NDJSON through `CompressionStream("gzip")` into a Blob). It runs in a Web Worker (`convert.worker.ts`); nothing here touches the DOM.

import { endLine, headerLine, importFileName, ImportFileSink } from "./import-file";
import { HuaweiExportImporter } from "./importer";
import type { ImportProgress } from "./importer";
import { ConvertError } from "./types";
import type { ConvertProgress, ConvertResult } from "./types";
import { openZipSource } from "./zip-source";

export interface ConvertOptions {
  /** The export ZIP. */
  file: Blob;
  /** Its name, recorded in the import file's header. */
  exportName: string;
  password: string;
  onProgress?: (progress: ConvertProgress) => void;
  /** Aborting stops between records; the result is a `cancelled` error and nothing is kept. */
  signal?: AbortSignal;
  /** The time the import file is stamped with (header `createdAt` and file name). */
  now?: Date;
}

export function progressOf(progress: ImportProgress): ConvertProgress {
  const s = progress.summary;
  return {
    fileName: progress.fileName,
    fileIndex: progress.fileIndex,
    fileCount: progress.fileCount,
    fraction: progress.fraction,
    found: {
      workouts: s.workoutsFound,
      heartRateMinutes: s.heartRateReadings,
      sleepSegments: s.sleepSegmentsFound,
      weighIns: s.weighInsFound,
      meals: s.mealsFound,
      badRecords: s.badRecords,
    },
  };
}

function cancelled(): ConvertError {
  return new ConvertError("cancelled", "Cancelled");
}

export async function convertExport(options: ConvertOptions): Promise<ConvertResult> {
  const { signal } = options;
  if (signal?.aborted) throw cancelled();
  const source = await openZipSource(options.file, options.password, signal).catch((e: unknown) => {
    if (signal?.aborted) throw cancelled();
    throw e;
  });
  try {
    const gzip = new CompressionStream("gzip");
    const writer = gzip.writable.getWriter();
    const compressed = new Response(gzip.readable).blob();
    // A failed run abandons the stream; nobody reads this promise then.
    compressed.catch(() => {});
    const sink = new ImportFileSink(writer);
    const now = options.now ?? new Date();
    sink.line(headerLine(options.exportName, now.getTime()));
    const importer = new HuaweiExportImporter(sink, {
      onProgress: (progress) => options.onProgress?.(progressOf(progress)),
      isCancelled: () => signal?.aborted === true,
    });
    try {
      const summary = await importer.run(source);
      if (summary.cancelled || signal?.aborted) throw cancelled();
      const json = summary.toJson();
      const profile = importer.profile();
      sink.line(endLine(json, profile));
      await sink.drain();
      await writer.close();
      return {
        blob: await compressed,
        fileName: importFileName(now),
        summary: json,
        profile,
        rows: { ...sink.rows },
      };
    } catch (e) {
      await writer.abort(e).catch(() => {});
      if (signal?.aborted) throw cancelled();
      if (e instanceof ConvertError) throw e;
      throw new ConvertError("failed", e instanceof Error ? e.message : String(e));
    }
  } finally {
    await source.close().catch(() => {});
  }
}
