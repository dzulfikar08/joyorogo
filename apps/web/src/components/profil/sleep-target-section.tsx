import { MIN_RECOMMENDED_SLEEP_HOURS, SLEEP_TARGET_HOURS } from "@joyorogo/api/lib/engine";
import { cn } from "@joyorogo/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SectionTitle } from "@/components/kit/surface";
import { fmtKg } from "@/lib/format";
import { orpc } from "@/utils/orpc";

/** Target tidur: one of 7 / 7.5 / 8 / 8.5 / 9 hours. Tapping saves at once. */
export function SleepTargetSection({ current }: { current: number }) {
  const { t } = useTranslation(["settings", "energy"]);
  const queryClient = useQueryClient();
  const save = useMutation(
    orpc.profile.setSleepTarget.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.profile.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.day.key() }),
        ]);
        toast.success(t("energy:saved"));
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <section id="sleep-target" className="scroll-mt-4">
      <SectionTitle className="mt-7">{t("settings:plan.sleepTarget.title")}</SectionTitle>
      <p className="-mt-1 mb-3 px-1 text-sm leading-relaxed text-muted-foreground">
        {t("settings:plan.sleepTarget.subtitle")}
      </p>
      <div
        role="radiogroup"
        aria-label={t("settings:plan.sleepTarget.group")}
        className="grid grid-cols-4 gap-2 sm:grid-cols-7"
      >
        {SLEEP_TARGET_HOURS.map((hours) => {
          const active = hours === current;
          return (
            <button
              key={hours}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={save.isPending}
              onClick={() => (active ? undefined : save.mutate({ hours }))}
              className={cn(
                "pressable flex min-h-14 items-center justify-center rounded-2xl bg-card text-base font-extrabold tabular-nums focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-60",
                active ? "bg-tidur-soft text-tidur-ink ring-2 ring-inset ring-tidur" : "hover:bg-muted/50",
              )}
            >
              {t("settings:plan.sleepTarget.option", { hours: fmtKg(hours) })}
            </button>
          );
        })}
      </div>
      {current < MIN_RECOMMENDED_SLEEP_HOURS && (
        <p className="mt-2 px-1 text-sm leading-relaxed text-muted-foreground">
          {t("settings:plan.sleepTarget.lowNote")}
        </p>
      )}
    </section>
  );
}
