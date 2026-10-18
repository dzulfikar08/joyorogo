import { useQueryClient } from "@tanstack/react-query";
import { Flame, Footprints, Minus, Percent, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ADD_BACK_CAPS,
  ADD_BACK_PCT,
  ADD_BACK_SOURCES,
  ADD_BACK_STEP_THRESHOLD,
  type AddBackCap,
  type AddBackPrefKey,
  type AddBackSettings,
  type AddBackSource,
} from "@joyorogo/api/lib/exercise-credit";
import { Card, FieldLabel, IconChip, ListGroup, ListRow, SectionTitle, Segmented } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { saveAddBackPref, storedAddBackSettings } from "@/lib/exercise-credit-prefs";
import { fmtInt } from "@/lib/format";
import { syncPrefs } from "@/lib/prefs-sync";
import { orpc } from "@/utils/orpc";

function Stepper({
  label,
  text,
  canDecrease,
  canIncrease,
  onStep,
}: {
  label: string;
  text: string;
  canDecrease: boolean;
  canIncrease: boolean;
  onStep: (direction: -1 | 1) => void;
}) {
  const button =
    "grid size-9 place-items-center rounded-full bg-muted text-foreground transition-colors hover:bg-muted/70 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-40";
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <button type="button" aria-label="-" disabled={!canDecrease} onClick={() => onStep(-1)} className={button}>
        <Minus className="size-4" aria-hidden />
      </button>
      <span className="min-w-[4.5rem] text-center text-sm font-semibold tabular-nums" aria-live="polite">
        {text}
      </span>
      <button type="button" aria-label="+" disabled={!canIncrease} onClick={() => onStep(1)} className={button}>
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** How much recorded exercise Sisa adds back. The server computes it; this only edits the synced settings. */
export function ExerciseCreditSection() {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<AddBackSettings>(storedAddBackSettings);

  // Pushes the edit before Beranda refetches: the server reads the settings from the synced record.
  const save = (key: AddBackPrefKey, value: unknown, next: Partial<AddBackSettings>) => {
    setSettings((current) => ({ ...current, ...next }));
    saveAddBackPref(key, value);
    void syncPrefs()
      .catch(() => null)
      .then(() =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.day.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.fasting.key() }),
        ]),
      );
  };

  const stepPct = (direction: -1 | 1) => {
    const pct = settings.pct + direction * ADD_BACK_PCT.step;
    save("exercise.addBack.pct", pct, { pct });
  };
  const stepThreshold = (direction: -1 | 1) => {
    const stepThreshold = settings.stepThreshold + direction * ADD_BACK_STEP_THRESHOLD.step;
    save("exercise.addBack.stepThreshold", stepThreshold, { stepThreshold });
  };

  return (
    <>
      <SectionTitle className="mt-7">{t("exerciseCredit.title")}</SectionTitle>
      <ListGroup>
        <ListRow
          icon={
            <IconChip tone="bakar">
              <Flame />
            </IconChip>
          }
          title={t("exerciseCredit.enabled.title")}
          subtitle={t("exerciseCredit.enabled.hint")}
          trailing={
            <Switch
              label={t("exerciseCredit.enabled.title")}
              checked={settings.enabled}
              onCheckedChange={(enabled) => save("exercise.addBack.enabled", enabled, { enabled })}
            />
          }
        />
        {settings.enabled && (
          <>
            <ListRow
              icon={
                <IconChip tone="bakar">
                  <Percent />
                </IconChip>
              }
              title={t("exerciseCredit.pct.title")}
              subtitle={t("exerciseCredit.pct.hint")}
              trailing={
                <Stepper
                  label={t("exerciseCredit.pct.aria")}
                  text={t("exerciseCredit.pct.value", { pct: settings.pct })}
                  canDecrease={settings.pct > ADD_BACK_PCT.min}
                  canIncrease={settings.pct < ADD_BACK_PCT.max}
                  onStep={stepPct}
                />
              }
            />
            {settings.source === "workouts+steps" && (
              <ListRow
                icon={
                  <IconChip tone="tidur">
                    <Footprints />
                  </IconChip>
                }
                title={t("exerciseCredit.stepThreshold.title")}
                subtitle={t("exerciseCredit.stepThreshold.hint")}
                trailing={
                  <Stepper
                    label={t("exerciseCredit.stepThreshold.aria")}
                    text={t("exerciseCredit.stepThreshold.value", { steps: fmtInt(settings.stepThreshold) })}
                    canDecrease={settings.stepThreshold > ADD_BACK_STEP_THRESHOLD.min}
                    canIncrease={settings.stepThreshold < ADD_BACK_STEP_THRESHOLD.max}
                    onStep={stepThreshold}
                  />
                }
              />
            )}
          </>
        )}
      </ListGroup>
      {settings.enabled && (
        <Card className="mt-3 space-y-4">
          <div className="space-y-2">
            <FieldLabel>{t("exerciseCredit.source.title")}</FieldLabel>
            <Segmented<AddBackSource>
              label={t("exerciseCredit.source.title")}
              value={settings.source}
              onChange={(source) => save("exercise.addBack.source", source, { source })}
              options={ADD_BACK_SOURCES.map((source) => ({
                value: source,
                label: t(source === "workouts" ? "exerciseCredit.source.workouts" : "exerciseCredit.source.workoutsSteps"),
              }))}
            />
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">{t("exerciseCredit.source.hint")}</p>
          </div>
          <div className="space-y-2">
            <FieldLabel>{t("exerciseCredit.cap.title")}</FieldLabel>
            <Segmented<`${AddBackCap}`>
              label={t("exerciseCredit.cap.aria")}
              value={`${settings.cap}`}
              onChange={(value) => {
                const cap = ADD_BACK_CAPS.find((candidate) => `${candidate}` === value) ?? settings.cap;
                save("exercise.addBack.cap", cap, { cap });
              }}
              options={ADD_BACK_CAPS.map((cap) => ({
                value: `${cap}` as `${AddBackCap}`,
                label: cap === "none" ? t("exerciseCredit.cap.none") : t("exerciseCredit.cap.kcal", { kcal: fmtInt(cap) }),
              }))}
            />
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">{t("exerciseCredit.cap.hint")}</p>
          </div>
        </Card>
      )}
    </>
  );
}
