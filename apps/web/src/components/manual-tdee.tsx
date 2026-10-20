import { MANUAL_TDEE_MAX_KCAL, MANUAL_TDEE_MIN_KCAL, MANUAL_TDEE_WARN_ABOVE_FACTOR, manualTdeeWarning } from "@joyorogo/api/lib/manual-tdee";
import type { ManualTdeeInfo } from "@joyorogo/api/lib/manual-tdee";
import type { Targets } from "@joyorogo/api/lib/engine";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Scale } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { CollapsibleNotice } from "@/components/collapsible-notice";
import { fmtInt, parseNum } from "@/lib/format";
import { orpc } from "@/utils/orpc";

/** Refresh everything a changed TDEE moves: the profile (targets, activity guide) and the day summaries. */
function useManualTdeeMutations(onTargets?: (targets: Targets) => void) {
  const queryClient = useQueryClient();
  const { t } = useTranslation("energy");
  const refresh = async (targets: Targets, message: string) => {
    onTargets?.(targets);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.profile.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.day.key() }),
    ]);
    toast.success(message);
  };
  const onError = (error: Error) => toast.error(error.message);
  const save = useMutation(
    orpc.profile.setManualTdee.mutationOptions({
      onSuccess: (data, input) => refresh(data.targets, t("manual.saved", { kcal: input.kcal })),
      onError,
    }),
  );
  const clear = useMutation(
    orpc.profile.clearManualTdee.mutationOptions({
      onSuccess: (data) => refresh(data.targets, t("manual.resetDone")),
      onError,
    }),
  );
  const dismiss = useMutation(
    orpc.profile.dismissManualTdeeSuggestion.mutationOptions({
      onSuccess: (data) => refresh(data.targets, t("manual.suggest.dismissed")),
      onError,
    }),
  );
  return { save, clear, dismiss };
}

/**
 * The input for "Pakai TDEE sendiri": whole kcal between 1.000 and 6.000, our estimate next to it with the difference,
 * a warning (never a block) when it is under our BMR or far above our TDEE, and the way back to the automatic estimate.
 */
export function ManualTdeeForm({
  info,
  onSaved,
  className,
}: {
  info: ManualTdeeInfo;
  /** the targets the server built after the change (onboarding shows them) */
  onSaved?: (targets: Targets) => void;
  className?: string;
}) {
  const { t } = useTranslation("energy");
  const { save, clear } = useManualTdeeMutations(onSaved);
  const [draft, setDraft] = useState(info.kcal === null ? "" : String(info.kcal));
  const [touched, setTouched] = useState(false);
  const typed = parseNum(draft);
  const valid =
    typed !== null && Number.isInteger(typed) && typed >= MANUAL_TDEE_MIN_KCAL && typed <= MANUAL_TDEE_MAX_KCAL;
  const warning = valid ? manualTdeeWarning(typed, info.bmrKcal, info.computedKcal) : null;
  const diff = valid ? typed - info.computedKcal : null;
  const busy = save.isPending || clear.isPending;

  const error = !touched
    ? null
    : typed === null
      ? t("manual.error.empty")
      : valid
        ? null
        : t("manual.error.range", { min: fmtInt(MANUAL_TDEE_MIN_KCAL), max: fmtInt(MANUAL_TDEE_MAX_KCAL) });

  const submit = () => {
    setTouched(true);
    if (valid) save.mutate({ kcal: typed });
  };

  return (
    <div className={className}>
      <label htmlFor="manual-tdee" className="text-sm font-semibold">
        {t("manual.label")}
      </label>
      <Input
        id="manual-tdee"
        className="mt-1.5"
        type="number"
        inputMode="numeric"
        step="1"
        min={MANUAL_TDEE_MIN_KCAL}
        max={MANUAL_TDEE_MAX_KCAL}
        placeholder={t("manual.placeholder")}
        value={draft}
        aria-invalid={error !== null}
        aria-describedby="manual-tdee-help"
        disabled={busy}
        onChange={(event) => {
          setDraft(event.target.value);
          setTouched(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
        }}
      />
      <div id="manual-tdee-help" className="mt-2 space-y-1 text-sm leading-relaxed text-muted-foreground tabular-nums">
        <p className="font-semibold text-foreground">{t("manual.reference", { kcal: fmtInt(info.computedKcal) })}</p>
        {diff !== null && (
          <p>
            {diff === 0
              ? t("manual.diff.same")
              : t(diff > 0 ? "manual.diff.more" : "manual.diff.less", { kcal: fmtInt(Math.abs(diff)) })}
          </p>
        )}
        {error && (
          <p role="alert" className="font-medium text-destructive">
            {error}
          </p>
        )}
        {warning && (
          <p className="rounded-xl bg-muted px-3 py-2 font-medium text-foreground">
            {warning === "BELOW_BMR"
              ? t("manual.warn.BELOW_BMR", { bmr: fmtInt(info.bmrKcal) })
              : t("manual.warn.ABOVE_RANGE", { kcal: fmtInt(Math.round(info.computedKcal * MANUAL_TDEE_WARN_ABOVE_FACTOR)) })}
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Button className="min-h-11" disabled={busy || (touched && !valid) || draft.trim() === ""} onClick={submit}>
          {t("manual.save")}
        </Button>
        {info.kcal !== null && (
          <Button
            variant="ghost"
            className="min-h-11"
            disabled={busy}
            onClick={() => {
              setDraft("");
              setTouched(false);
              clear.mutate({});
            }}
          >
            {t("manual.reset")}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The calibration's gentle suggestion: shown only after two weekly measurements in a row more than 10% from the typed
 * TDEE. One tap uses the observed estimate, one tap leaves the number alone; nothing is ever applied by itself.
 */
export function ManualTdeeSuggestionCard({
  info,
  className,
}: {
  info: ManualTdeeInfo | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation("energy");
  const { save, dismiss } = useManualTdeeMutations();
  if (!info?.suggestion || info.kcal === null) return null;
  const busy = save.isPending || dismiss.isPending;
  const { kcal: measured } = info.suggestion;
  return (
    <CollapsibleNotice
      id="manual-tdee"
      className={className}
      title={t("manual.suggest.title")}
      icon={<Scale />}
    >
      <p className="text-sm leading-relaxed font-semibold tabular-nums">
        {t("manual.suggest.body", { measured: fmtInt(measured), manual: fmtInt(info.kcal) })}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("manual.suggest.hint")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4">
        <Button
          size="sm"
          className="min-h-11"
          disabled={busy}
          onClick={() => save.mutate({ kcal: measured })}
        >
          {t("manual.suggest.accept")}
        </Button>
        <Button size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={() => dismiss.mutate({})}>
          {t("manual.suggest.dismiss")}
        </Button>
        <Link
          to="/panduan/kalori"
          hash="manual"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
        >
          {t("manual.learn")}
        </Link>
      </div>
    </CollapsibleNotice>
  );
}
