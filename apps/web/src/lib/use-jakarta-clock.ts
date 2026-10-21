import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { advanceClock } from "@joyorogo/api/lib/jakarta-clock";
import { getActiveDayZone } from "@joyorogo/i18n";
import { jakartaToday } from "@joyorogo/api/lib/engine";

const TICK_MS = 30 * 1000;

/**
 * The live day (in the active day zone) (`today`) and a `now` for time-of-day copy. A tab left open overnight (or a phone browser that
 * resumes from the background) rendered `jakartaToday()` once and stayed on yesterday: the header showed the old date
 * and the summary kept yesterday's numbers. Refreshes when the tab becomes visible again and from a 30 s tick that
 * crosses midnight in that zone while it stays open.
 *
 * When the day changes every cached query is invalidated: queries keyed without a date (`water.today`,
 * `fasting.today`, ...) resolve "today" on the server, so their keys do not change at midnight.
 */
export function useJakartaClock(): { today: string; now: Date } {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => new Date());
  const today = jakartaToday(now);
  const seenDay = useRef(today);

  useEffect(() => {
    const advance = () => setNow((prev) => advanceClock(prev, new Date(), getActiveDayZone()));
    const onVisible = () => {
      if (document.visibilityState === "visible") advance();
    };
    const timer = setInterval(advance, TICK_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (seenDay.current === today) return;
    seenDay.current = today;
    void queryClient.invalidateQueries();
  }, [today, queryClient]);

  return { today, now };
}
