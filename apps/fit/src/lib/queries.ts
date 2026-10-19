import { shiftDate } from "@joyorogo/api/lib/engine";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { fitApi } from "./fit-api";
import { orpc } from "./orpc";
import type { SleepResponse } from "./sleep-stages";

type Win = { from: string; to: string };

/**
 * The windowed reads, shared by the pages and by the route loaders that start them early. A range switch keeps the
 * previous window on screen (dimmed by the page) until the new one lands instead of dropping back to skeletons.
 */
export const recoveryQuery = (win: Win) =>
  orpc.fitWeb.recovery.queryOptions({ input: win, placeholderData: keepPreviousData });

export const workoutsQuery = (win: Win) =>
  orpc.fitWeb.workouts.queryOptions({ input: win, placeholderData: keepPreviousData });


/** The longest window the JoyoFit API serves in one call. */
const STAGE_WINDOW_DAYS = 92;

/** The stage window ends at `to` and is at most STAGE_WINDOW_DAYS long; `clamped` is where it starts. */
export function sleepStagesQuery(from: string, to: string) {
  const clamped =
    from < shiftDate(to, -(STAGE_WINDOW_DAYS - 1)) ? shiftDate(to, -(STAGE_WINDOW_DAYS - 1)) : from;
  return {
    clamped,
    options: queryOptions({
      queryKey: ["fit-api", "sleep", clamped, to],
      queryFn: () => fitApi<SleepResponse>(`/sleep?from=${clamped}&to=${to}`),
      placeholderData: keepPreviousData,
    }),
  };
}
