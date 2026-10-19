// One chosen file, from bytes to "ready to upload" (or the reason it is not). The screen only orchestrates and draws.

import type { FitWebWorkout } from "@joyorogo/api/lib/fit-web";

import type { AnalysisOptions } from "./analysis";
import { type Collision, findCollision } from "./collision";
import { type BuildFailure, type BuiltDoc, buildDoc } from "./doc";
import { readWorkoutFile } from "./read";
import { MAX_FILE_BYTES } from "./types";
import { type ImportFailure, type ParsedActivity, isImportError } from "./types";

export type Prepared =
  | { kind: "failed"; reason: ImportFailure | BuildFailure }
  | { kind: "ready"; activity: ParsedActivity; built: BuiltDoc; collision: Collision };

/** Workouts the account already has around a file's time span (a day either side), for the duplicate and overlap check. */
export type ExistingLookup = (fromDay: string, toDay: string) => Promise<readonly FitWebWorkout[]>;

const DAY = 86_400;
const WIB = 7 * 3600;
const dayOf = (unixSec: number): string =>
  new Date((unixSec + WIB) * 1000).toISOString().slice(0, 10);

export async function prepareFile(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
  options: AnalysisOptions,
  existing: ExistingLookup,
): Promise<Prepared> {
  if (file.size > MAX_FILE_BYTES) return { kind: "failed", reason: "too-large" };
  const parsed = readWorkoutFile(file.name, new Uint8Array(await file.arrayBuffer()));
  if (isImportError(parsed)) return { kind: "failed", reason: parsed.reason };
  const built = await buildDoc(parsed, options);
  if ("ok" in built) return { kind: "failed", reason: built.reason };
  const nearby = await existing(dayOf(parsed.start - DAY), dayOf(parsed.end + DAY));
  return { kind: "ready", activity: parsed, built, collision: findCollision(parsed, nearby) };
}
