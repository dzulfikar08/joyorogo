// "Kirim ke HP": the converted import file goes to the person's JoyoFit account, where the phone picks it up
// (docs/huawei-web-import.md in the joyofit repo). One POST through the JoyoRogo API's proxy (`/api/fit/imports`, apps/server/src/fit-proxy.ts),
// which relays it to `POST /v1/imports` of the JoyoFit API; that API enforces the Pro rule and the size limit itself.

import { FitApiError, fitApiWithStatus } from "../fit-api";
import { IMPORT_CONTENT_TYPE } from "./types";

/** The JoyoFit API's default limit for an import file (and the proxy's): the screen words a 413 with it. */
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

export type SendFailure = "paywall" | "unauthorized" | "too_large" | "network" | "server";

export type SendResult = { ok: true } | { ok: false; reason: SendFailure; detail?: string };

/** An upload that failed, as the screen words it: the same mapping as the watch face upload (`faceUploadError`). */
function sendError(error: unknown): Extract<SendResult, { ok: false }> {
  // Everything but a refusal of the API (a success whose body is not JSON) is a server that answered wrongly.
  if (!(error instanceof FitApiError)) return { ok: false, reason: "server" };
  if (error.status === 0) return { ok: false, reason: "network" };
  if (error.status === 401) return { ok: false, reason: "unauthorized" };
  if (error.status === 402) return { ok: false, reason: "paywall" };
  if (error.status === 413) return { ok: false, reason: "too_large" };
  return { ok: false, reason: "server", detail: error.code || undefined };
}

/** Sends the import file as the request body (the browser sets Content-Length from the Blob; the proxy refuses a body without one). */
export async function sendImport(
  blob: Blob,
  fileName: string,
  signal?: AbortSignal,
): Promise<SendResult> {
  try {
    await fitApiWithStatus(`/imports?filename=${encodeURIComponent(fileName)}`, {
      method: "POST",
      headers: { "content-type": IMPORT_CONTENT_TYPE },
      body: blob,
      signal: signal ?? null,
    });
    return { ok: true };
  } catch (error) {
    return sendError(error);
  }
}
