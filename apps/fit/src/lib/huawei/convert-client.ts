// The page's side of the converter: runs `convert.worker.ts` on the picked ZIP and hands back progress, the import file or a `ConvertError`.

import type { WorkerReply, WorkerRequest } from "./convert.worker";
import { ConvertError } from "./types";
import type { ConvertProgress, ConvertResult } from "./types";

export interface Conversion {
  result: Promise<ConvertResult>;
  /** Stops the run (the worker is terminated, so what it held is freed at once); `result` rejects with `cancelled`. */
  cancel(): void;
}

/** Converts `file` (a Huawei Privacy Centre export ZIP) with `password` in a Web Worker. The password is sent once and not kept here. */
export function startConversion(
  file: File,
  password: string,
  onProgress: (progress: ConvertProgress) => void,
): Conversion {
  const worker = new Worker(new URL("./convert.worker.ts", import.meta.url), { type: "module" });
  const { promise, resolve, reject } = Promise.withResolvers<ConvertResult>();
  // Settling twice is a no-op, so a late message after a cancel changes nothing.
  const end = () => worker.terminate();
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    if (reply.type === "progress") {
      onProgress(reply.progress);
      return;
    }
    end();
    if (reply.type === "done") resolve(reply.result);
    else reject(new ConvertError(reply.kind, reply.message));
  };
  worker.onerror = (event) => {
    end();
    reject(new ConvertError("failed", event.message || "The converter could not start"));
  };
  const start: WorkerRequest = { type: "start", file, password };
  worker.postMessage(start);
  return {
    result: promise,
    cancel: () => {
      end();
      reject(new ConvertError("cancelled", "Cancelled"));
    },
  };
}
