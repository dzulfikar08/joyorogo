import { Button } from "@joyorogo/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { DatePace } from "@joyorogo/api/lib/engine";
import { cn } from "@joyorogo/ui/lib/utils";

import { CollapsibleNotice } from "@/components/collapsible-notice";
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
  collapsible = false,
}: {
  pace: DatePace | null | undefined;
  className?: string;
  /** Beranda folds it to one row; the target screen shows it open. */
  collapsible?: boolean;
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
  const body = (
    <>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {t(`plan.datePace.${pace.reason === "passed" ? "passed." : ""}${pace.direction}.body`, {
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
    </>
  );
  const title = t(pace.reason === "passed" ? "plan.datePace.passed.title" : "plan.datePace.title");
  if (collapsible) {
    return (
      <CollapsibleNotice
        id="target-pace"
        className={cn("bg-bakar-soft", className)}
        title={title}
        icon={<CircleAlert />}
      >
        {body}
      </CollapsibleNotice>
    );
  }
  return (
    <div className={cn("rounded-2xl bg-bakar-soft p-4", className)} data-testid="target-pace-notice">
      <p className="flex items-start gap-1.5 text-sm leading-snug font-bold text-bakar-ink">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {title}
      </p>
      {body}
    </div>
  );
}
