import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import { FEEDING_TYPES } from "@joyorogo/api/lib/maternal";
import type { FeedingType } from "@joyorogo/api/lib/maternal";
import { Button } from "@joyorogo/ui/components/button";
import { cn } from "@joyorogo/ui/lib/utils";

import { Segmented } from "@/components/kit/surface";
import { orpc } from "@/utils/orpc";
import { DateField } from "./maternal-form";

function Choice({
  active,
  title,
  hint,
  onClick,
}: {
  active: boolean;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "pressable flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        active ? "bg-makan-soft ring-2 ring-makan" : "bg-muted",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-bold">{title}</span>
        <span className="block text-sm text-muted-foreground">{hint}</span>
      </span>
      {active && <Check className="size-5 shrink-0 text-makan-ink" aria-hidden />}
    </button>
  );
}

/**
 * Body of the "Sudah melahirkan" sheet: birth date, then Menyusui (exclusive
 * or partial) or back to a plain plan; afterwards the postpartum note.
 */
export function EndPregnancySheetBody({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(["maternal", "common", "settings"]);
  const queryClient = useQueryClient();
  const today = jakartaToday();
  const [birthDate, setBirthDate] = useState(today);
  const [next, setNext] = useState<"breastfeeding" | "none">("breastfeeding");
  const [feeding, setFeeding] = useState<FeedingType>("exclusive");
  const [done, setDone] = useState(false);

  const end = useMutation(
    orpc.profile.endPregnancy.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries();
        toast.success(t("maternal:end.done"));
        setDone(true);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-makan-soft p-4">
          <p className="text-[0.9375rem] font-bold text-makan-ink">{t("maternal:end.postpartum.title")}</p>
          <p className="mt-1.5 text-sm leading-relaxed">{t("maternal:end.postpartum.body")}</p>
          <p className="mt-1.5 text-sm leading-relaxed">{t("maternal:end.postpartum.check")}</p>
        </div>
        <Button className="w-full" onClick={onClose}>
          {t("common:actions.close")}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        end.mutate({
          next,
          birthDate,
          ...(next === "breastfeeding" ? { feeding } : {}),
        });
      }}
    >
      <div>
        <p className="mb-2 px-1 text-sm font-bold">{t("maternal:end.birthDate")}</p>
        <DateField
          label={t("maternal:end.birthDate")}
          value={birthDate}
          onChange={setBirthDate}
          from={shiftDate(today, -730)}
          to={today}
          placeholder={t("maternal:form.date.pick")}
        />
      </div>
      <div className="space-y-2">
        <Choice
          active={next === "breastfeeding"}
          title={t("maternal:end.breastfeeding")}
          hint={t("maternal:end.breastfeedingHint")}
          onClick={() => setNext("breastfeeding")}
        />
        {next === "breastfeeding" && (
          <div className="px-1 pb-1">
            <Segmented
              label={t("maternal:form.feeding.label")}
              value={feeding}
              onChange={setFeeding}
              options={FEEDING_TYPES.map((key) => ({
                value: key,
                label: t(`maternal:form.feeding.${key}`),
              }))}
            />
            <p className="mt-2 px-1 text-xs text-muted-foreground">
              {t(feeding === "exclusive" ? "maternal:form.feeding.exclusiveHint" : "maternal:form.feeding.partialHint")}
            </p>
          </div>
        )}
        <Choice
          active={next === "none"}
          title={t("maternal:end.none")}
          hint={t("maternal:end.noneHint")}
          onClick={() => setNext("none")}
        />
      </div>
      <Button type="submit" className="w-full" disabled={end.isPending}>
        {end.isPending ? t("settings:state.saving") : t("maternal:end.confirm")}
      </Button>
    </form>
  );
}
