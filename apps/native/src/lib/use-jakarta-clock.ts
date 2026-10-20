import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { jakartaToday } from "@joyorogo/api/lib/engine";

import { advanceClock } from "@joyorogo/api/lib/jakarta-clock";

const TICK_MS = 30 * 1000;

/**
 * The live WIB day (`today`) and a `now` for time-of-day copy, kept current while the screen stays mounted. A phone
 * keeps the Beranda tab alive overnight, so reading `jakartaToday()` during render left the screen on yesterday's day
 * (and yesterday's summary) after midnight. Both refresh when the app returns to the foreground and from a 30 s tick
 * that crosses WIB midnight while the app stays open (short ticks, not one long timeout: a long one is dropped when the
 * process is suspended and Android warns about it).
 *
 * When the day changes, every cached query is invalidated: day-scoped queries keyed without a date (`day.summary`,
 * `water.today`, `fasting.today`, ...) resolve "today" on the server, so their keys do not change at midnight and would
 * otherwise keep serving yesterday's numbers.
 */
export function useJakartaClock(): { today: string; now: Date } {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => new Date());
  const today = jakartaToday(now);
  const seenDay = useRef(today);

  useEffect(() => {
    const advance = () => setNow((prev) => advanceClock(prev, new Date()));
    const timer = setInterval(advance, TICK_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") advance();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (seenDay.current === today) return;
    seenDay.current = today;
    void queryClient.invalidateQueries();
  }, [today, queryClient]);

  return { today, now };
}
