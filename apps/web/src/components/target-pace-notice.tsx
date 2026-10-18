import { Button } from "@joyorogo/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { DatePace } from "@joyorogo/api/lib/engine";
import { cn } from "@joyorogo/ui/lib/utils";

import { fmtDateLong, fmtKg } from "@/lib/format";
import { client, orpc } from "@/utils/orpc";

/**
 * The stored target date asks for more than the safe pace allows (the plan quietly
 * follows the clamp instead). Says so, with the date the safe pace really reaches and
 * a one-tap switch to it. Renders nothing when the date is reachable.
 */
export function TargetPaceNotice({
  pace,
  className,
}: {
  pace: DatePace | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const apply = useMutation({
    mutationFn: (next: DatePace) =>
      client.profile.updateTargets({
        targetWeightKg: next.targetWeightKg,
        targetDate: next.reachDate,
        goal: next.direction,
      }),
    onSuccess: () => {
      toast.success(t("plan.datePace.saved"));
      void queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.day.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.weight.key() });
    },
    onError: (error) => toast.error(error.message),
  });
  if (!pace) return null;
  const date = fmtDateLong(pace.reachDate).replace(/^\w+, /, "");
  return (
    <div className={cn("rounded-2xl bg-bakar-soft p-4", className)} data-testid="target-pace-notice">
      <p className="flex items-start gap-1.5 text-sm leading-snug font-bold text-bakar-ink">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t("plan.datePace.title")}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {t(`plan.datePace.${pace.direction}.body`, {
          kg: fmtKg(pace.kg),
          count: pace.feasibleDays,
          date,
        })}
      </p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="mt-3"
        disabled={apply.isPending}
        onClick={() => apply.mutate(pace)}
      >
        {t("plan.datePace.use", { date })}
      </Button>
    </div>
  );
}
