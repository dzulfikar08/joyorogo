import { useQuery } from "@tanstack/react-query";

import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";

import { buildSources, type SourceRow } from "@/src/lib/sources";
import { useHealthStatus, type HealthStatus } from "@/src/lib/use-health-status";
import { orpc } from "@/utils/orpc";

const atOf = (value: Date | string | number): number => new Date(value).getTime();

/**
 * Every place JoyoRogo's numbers come from, with whether it is linked and when it last delivered. One reading for the
 * sources screen and the setup checklist, so they can never disagree. `weights` is for the scale row only (a year of
 * weigh-ins): the checklist leaves it off. `rows` is null until everything needed has loaded, and stays null on an
 * error: a failed request must not read as "not connected".
 */
export function useSources({
  enabled = true,
  weights = true,
}: { enabled?: boolean; weights?: boolean } = {}) {
  const today = jakartaToday();
  const health = useHealthStatus(enabled);
  const strava = useQuery({ ...orpc.strava.status.queryOptions(), enabled });
  const coros = useQuery({ ...orpc.coros.status.queryOptions(), enabled });
  const exercise = useQuery({
    ...orpc.exercise.recent.queryOptions({ input: { days: 30 } }),
    enabled,
  });
  const history = useQuery({
    ...orpc.weight.history.queryOptions({ input: { limit: 365 } }),
    enabled: enabled && weights,
  });
  const day = useQuery({ ...orpc.day.summary.queryOptions({ input: { date: today } }), enabled });

  const queries = [health, strava, coros, exercise, day, ...(weights ? [history] : [])];
  const error = queries.find((query) => query.isError)?.error ?? null;
  const ready =
    health.data &&
    strava.data &&
    coros.data &&
    exercise.data &&
    day.data &&
    (!weights || history.data);

  const rows: SourceRow[] | null =
    ready && error === null
      ? buildSources({
          health: { connected: health.data.connected, lastAt: health.data.last?.at ?? null },
          strava: { connected: strava.data.connected },
          coros: { connected: coros.data.connected },
          exercise: exercise.data.items.map((item) => ({
            source: item.source,
            date: item.date,
            at: atOf(item.createdAt),
          })),
          weights: (history.data?.entries ?? []).map((entry) => ({
            source: entry.source,
            date: entry.date,
            at: atOf(entry.createdAt),
          })),
          allDaySource: day.data.exerciseCredit?.allDaySource ?? null,
          recentFrom: shiftDate(today, -6),
        })
      : null;

  return {
    rows,
    health: health.data as HealthStatus | undefined,
    error,
    refetch: () => Promise.all(queries.map((query) => query.refetch())),
    refreshing: queries.some((query) => query.isFetching),
  };
}
