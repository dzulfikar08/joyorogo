import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useTranslation } from "react-i18next";

import { jakartaToday } from "@joyorogo/api/lib/engine";

import { authClient } from "@/lib/auth-client";
import { syncReminders } from "@/src/lib/notifications";
import { orpc } from "@/utils/orpc";

/**
 * Keeps scheduled reminders in step with what the app knows: re-plans after
 * every app open/foreground and whenever a meal or weigh-in lands in today's
 * summary (logging invalidates it), so a logged meal drops today's reminder.
 * Also re-schedules after reboots/updates since the plan is rebuilt on launch.
 * Renders nothing; mount once inside the QueryClientProvider.
 */
export function ReminderSync() {
  const { i18n } = useTranslation();
  const language = i18n.language;
  const { data: session } = authClient.useSession();
  const signedIn = Boolean(session?.user.id);
  const summary = useQuery({ ...orpc.day.summary.queryOptions({ input: {} }), enabled: signedIn });
  const fasting = useQuery({ ...orpc.fasting.settings.queryOptions(), enabled: signedIn });
  const [day, setDay] = useState(jakartaToday);
  const { refetch } = summary;

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      setDay(jakartaToday());
      void refetch();
    });
    return () => sub.remove();
  }, [refetch]);

  const data = summary.data?.hasProfile ? summary.data : null;
  const known = data !== null;
  const sarapan = (data?.eatenByMeal.sarapan ?? 0) > 0;
  const makanSiang = (data?.eatenByMeal.makan_siang ?? 0) > 0;
  const makanMalam = (data?.eatenByMeal.makan_malam ?? 0) > 0;
  const weighedToday = data?.weightLoggedToday === true;
  // Naikin BB: kcal still to eat today; null for every other plan (and while unknown).
  const gainRemainingKcal =
    data?.targets && data.targets.maternal == null && data.targets.gain != null
      ? Math.round(data.targets.eatKcal - data.eatenKcal)
      : null;
  const pattern = fasting.data && fasting.data.pattern !== "off" ? fasting.data.pattern : null;
  const windowStart = fasting.data?.windowStart ?? null;
  const settled = !summary.isPending && !fasting.isPending;

  useEffect(() => {
    if (!signedIn || !settled) return;
    void syncReminders({
      eaten: known ? { sarapan, makan_siang: makanSiang, makan_malam: makanMalam } : null,
      weighedToday: known ? weighedToday : null,
      fasting: pattern !== null && windowStart !== null ? { pattern, windowStart } : null,
      gain: gainRemainingKcal !== null ? { remainingKcal: gainRemainingKcal } : null,
    });
    // `day` re-plans after midnight / app foreground even if the flags held;
    // `language` re-plans so notification text follows a language switch.
  }, [
    signedIn,
    settled,
    known,
    sarapan,
    makanSiang,
    makanMalam,
    weighedToday,
    pattern,
    windowStart,
    gainRemainingKcal,
    day,
    language,
  ]);

  return null;
}
