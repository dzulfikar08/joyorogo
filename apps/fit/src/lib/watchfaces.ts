// The watch face library of the JoyoFit cloud API (`/v1/watchfaces`, reached through the JoyoRogo API's `/api/fit/*`): what a
// face is, what is checked before a file is sent, and how the answers read.

import { FitApiError } from "./fit-api-error";

/** The JoyoFit API's own limits (watch-fit server/src/limits.ts); the screen checks them first so a doomed upload is never sent. */
export const MAX_FACE_BYTES = 8 * 1024 * 1024;
export const MAX_FACES = 40;

export interface WatchFace {
  id: string;
  /** The face's own title from the file, else the file name without its extension. */
  name: string;
  filename: string;
  size: number;
  sha256: string;
  /** Unix milliseconds. */
  createdAt: number;
}

export type FaceUploadFailure =
  | "extension"
  | "empty"
  | "too_large"
  | "invalid_hwt"
  | "library_full"
  | "paywall"
  | "unauthorized"
  | "network"
  | "server";

export type UploadOutcome =
  | { ok: true; face: WatchFace; existing: boolean }
  | { ok: false; reason: FaceUploadFailure; detail?: string };

/** Refuses a file before it is sent: wrong extension, empty, over the size limit. Null when it may go. */
export function checkFaceFile(
  file: Pick<File, "name" | "size">,
): Extract<UploadOutcome, { ok: false }> | null {
  if (!/\.hwt$/i.test(file.name)) return { ok: false, reason: "extension" };
  if (file.size === 0) return { ok: false, reason: "empty" };
  if (file.size > MAX_FACE_BYTES) return { ok: false, reason: "too_large" };
  return null;
}

/** An upload that failed, as the screen words it. `invalid_hwt` carries the API's reason. */
export function faceUploadError(error: unknown): Extract<UploadOutcome, { ok: false }> {
  if (!(error instanceof FitApiError)) return { ok: false, reason: "network" };
  if (error.status === 0) return { ok: false, reason: "network" };
  if (error.status === 401) return { ok: false, reason: "unauthorized" };
  if (error.status === 402) return { ok: false, reason: "paywall" };
  if (error.status === 413) return { ok: false, reason: "too_large" };
  if (error.status === 409 && error.code === "library_full")
    return { ok: false, reason: "library_full" };
  if (error.status === 400 && error.code === "invalid_hwt") {
    const reason = (error.body as { reason?: unknown } | null)?.reason;
    return {
      ok: false,
      reason: "invalid_hwt",
      detail: typeof reason === "string" ? reason : undefined,
    };
  }
  if (error.status === 400 && (error.code === "empty_body" || error.code === "length_mismatch"))
    return { ok: false, reason: "empty" };
  return { ok: false, reason: "server" };
}

/** The file name a download is saved as: the original name, always ending in .hwt. */
export function downloadName(face: Pick<WatchFace, "filename" | "name">): string {
  const base = face.filename || face.name || "watchface";
  return /\.hwt$/i.test(base) ? base : `${base}.hwt`;
}
