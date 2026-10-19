import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { CalendarDays, CalendarRange, ChevronRight, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { MealPlanActions } from "@/components/meal-plan/use-meal-plan";

type Scope = "day" | "week";

/** Plan again: today's open meals or the whole week, with a confirmation that says what stays. */
export function RegenSheet({
  today,
  actions,
  onClose,
}: {
  /** the open day that can be planned alone; null when today is not in the plan any more */
  today: string | null;
  actions: MealPlanActions;
  onClose: () => void;
}) {
  const { t } = useTranslation("mealPlan");
  const [scope, setScope] = useState<Scope | null>(null);
  const { generate, replanDay } = actions;
  const pending = generate.isPending || replanDay.isPending;

  const confirm = () => {
    if (scope === "day" && today) replanDay.mutate(today, { onSuccess: onClose });
    else generate.mutate(true, { onSuccess: onClose });
  };

  const choices: Array<{ scope: Scope; label: string; icon: React.ReactNode }> = [
    ...(today
      ? [{ scope: "day" as const, label: t("regen.day"), icon: <CalendarDays aria-hidden /> }]
      : []),
    { scope: "week", label: t("regen.week"), icon: <CalendarRange aria-hidden /> },
  ];

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title={t("regen.title")}
      description={
        scope === null ? undefined : scope === "day" ? t("regen.bodyDay") : t("regen.bodyWeek")
      }
    >
      {scope === null ? (
        <ul className="space-y-2">
          {choices.map((choice) => (
            <li key={choice.scope}>
              <button
                type="button"
                onClick={() => setScope(choice.scope)}
                className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-muted px-4 text-left text-[0.9375rem] font-semibold transition-colors hover:bg-border focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&>svg:first-child]:size-5 [&>svg:first-child]:shrink-0"
              >
                {choice.icon}
                <span className="min-w-0 flex-1">{choice.label}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="sm:flex-1" disabled={pending} onClick={confirm}>
            {pending && (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
            )}
            {pending ? t("regen.working") : t("regen.confirm")}
          </Button>
          <Button variant="ghost" className="sm:flex-1" disabled={pending} onClick={onClose}>
            {t("regen.cancel")}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
