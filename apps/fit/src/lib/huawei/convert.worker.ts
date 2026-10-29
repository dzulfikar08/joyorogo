/// <reference lib="webworker" />
// The Web Worker that converts a Huawei export (`convert.ts`). The page sends `start` once; progress, the result or an error come back.
// The password lives in this worker's memory for the length of the run and nowhere else: never stored, never logged.

import { convertExport } from "./convert";
import { ConvertError } from "./types";
import type { ConvertErrorKind, ConvertProgress, ConvertResult } from "./types";

export type WorkerRequest = { type: "start"; file: File; password: string } | { type: "cancel" };

export type WorkerReply =
  | { type: "progress"; progress: ConvertProgress }
  | { type: "done"; result: ConvertResult }
  | { type: "error"; kind: ConvertErrorKind; message: string };

const scope = self as DedicatedWorkerGlobalScope;
let abort: AbortController | null = null;

function reply(message: WorkerReply) {
  scope.postMessage(message);
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    abort?.abort();
    return;
  }
  if (abort) return;
  const controller = new AbortController();
  abort = controller;
  convertExport({
    file: message.file,
    exportName: message.file.name,
    password: message.password,
    signal: controller.signal,
    onProgress: (progress) => reply({ type: "progress", progress }),
  })
    .then((result) => reply({ type: "done", result }))
    .catch((e: unknown) => {
      if (e instanceof ConvertError) reply({ type: "error", kind: e.kind, message: e.message });
      else
        reply({
          type: "error",
          kind: "failed",
          message: e instanceof Error ? e.message : String(e),
        });
    })
    .finally(() => {
      abort = null;
    });
};
