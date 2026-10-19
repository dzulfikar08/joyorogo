// PUT one workout document to the JoyoRogo cloud (apps/server/src/watch-workout.ts) and say what happened.

import { SERVER_URL } from "@/lib/env";

export type UploadResult =
  | {
      ok: true;
      status: "created" | "updated" | "unchanged";
      start: number;
      version: number;
      bytes: number;
    }
  | {
      ok: false;
      reason:
        | "paywall"
        | "unauthorized"
        | "deleted"
        | "quota"
        | "too-large"
        | "invalid"
        | "network"
        | "server";
      detail?: string;
    };

export async function uploadWorkout(
  start: number,
  gzip: Uint8Array,
  signal?: AbortSignal,
): Promise<UploadResult> {
  let response: Response;
  try {
    response = await fetch(`${SERVER_URL}/api/watch-workouts/${start}`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/gzip" },
      body: gzip as BodyInit,
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, reason: "network" };
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    status?: string;
    version?: number;
    bytes?: number;
  };
  if (response.ok) {
    const status =
      body.status === "created" || body.status === "updated" || body.status === "unchanged"
        ? body.status
        : "created";
    return {
      ok: true,
      status,
      start,
      version: body.version ?? 1,
      bytes: body.bytes ?? gzip.byteLength,
    };
  }
  if (response.status === 401) return { ok: false, reason: "unauthorized" };
  if (response.status === 402) return { ok: false, reason: "paywall" };
  if (response.status === 410) return { ok: false, reason: "deleted" };
  if (response.status === 413)
    return { ok: false, reason: body.error === "quota" ? "quota" : "too-large" };
  if (response.status === 400)
    return { ok: false, reason: "invalid", detail: body.message ?? body.error };
  return { ok: false, reason: "server", detail: body.message ?? body.error };
}
