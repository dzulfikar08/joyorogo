/**
 * Where an export gets its data: the stored gzip document of one workout, `GET /api/watch-workouts/<start>/blob` on the
 * API (session cookie, open to the account whether or not Pro is active). It is gunzipped in the browser with a ceiling
 * on the output and validated with the same schema the server uses, so a workout that the app could not store is never
 * turned into a file.
 */

import { readDoc } from "@joyorogo/api/lib/watch-workout";
import type { WatchWorkoutDoc } from "@joyorogo/api/lib/watch-workout";

export type SourceErrorKind =
  | "unauthorized"
  | "not_found"
  | "unavailable"
  | "network"
  | "bad_document";

export class SourceError extends Error {
  constructor(
    readonly kind: SourceErrorKind,
    readonly status?: number,
  ) {
    super(`Workout document: ${kind}${status ? ` (${status})` : ""}`);
    this.name = "SourceError";
  }
}

export interface SourceOptions {
  /** Absolute API origin, no trailing slash. */
  baseUrl: string;
  signal?: AbortSignal;
  /** Only tests set this. */
  fetchImpl?: typeof fetch;
}

export async function fetchWorkoutDoc(
  start: number,
  options: SourceOptions,
): Promise<WatchWorkoutDoc> {
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${options.baseUrl}/api/watch-workouts/${start}/blob`, {
      credentials: "include",
      signal: options.signal ?? null,
    });
  } catch (error) {
    // A cancelled request is the caller's decision, not a failure to report.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new SourceError("network");
  }
  if (response.status === 401) throw new SourceError("unauthorized", 401);
  if (response.status === 404) throw new SourceError("not_found", 404);
  if (!response.ok) throw new SourceError("unavailable", response.status);
  try {
    return await readDoc(new Uint8Array(await response.arrayBuffer()));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new SourceError("bad_document");
  }
}
