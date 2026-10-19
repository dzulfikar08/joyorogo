import { useQueryClient } from "@tanstack/react-query";
import { Flame, Minus, Percent, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ADD_BACK_CAPS,
  ADD_BACK_PCT,
  type AddBackCap,
  type AddBackPrefKey,
  type AddBackSettings,
} from "@joyorogo/api/lib/exercise-credit";
import { Card, FieldLabel, IconChip, SectionTitle, Segmented } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { saveAddBackPref, storedAddBackSettings } from "@/lib/exercise-credit-prefs";
import { fmtInt } from "@/lib/format";
import { syncPrefs } from "@/lib/prefs-sync";
import { orpc } from "@/utils/orpc";

/** The "what if" the percent example uses: movement beyond the level, in kcal. The copy says 400. */
const EXAMPLE_EXTRA_KCAL = 400;

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

/**
 * How much measured movement beyond the activity level Sisa adds back, explained in the person's own numbers. The server
 * computes it; this only edits the synced settings.
 */
export function ExerciseCreditSection({ includedKcal }: { includedKcal: number }) {
  const { t } = useTranslation(["settings", "energy"]);
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

  return (
    <>
      <SectionTitle className="mt-7">{t("energy:credit.title")}</SectionTitle>
      <Card className="space-y-2 text-sm leading-relaxed text-muted-foreground">
        <p className="tabular-nums">{t("energy:credit.how", { kcal: fmtInt(includedKcal) })}</p>
        <p>{t("energy:credit.deskNote")}</p>
      </Card>
      <Card className="mt-3 space-y-4">
        <div>
          <div className="flex items-center gap-3">
            <IconChip tone="bakar">
              <Flame />
            </IconChip>
            <p className="min-w-0 flex-1 text-[0.9375rem] leading-snug font-semibold">
              {t("settings:exerciseCredit.enabled.title")}
            </p>
            <Switch
              label={t("settings:exerciseCredit.enabled.title")}
              checked={settings.enabled}
              onCheckedChange={(enabled) => save("exercise.addBack.enabled", enabled, { enabled })}
            />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t("settings:exerciseCredit.enabled.hint")}
          </p>
        </div>
        {settings.enabled && (
          <div className="border-t border-border pt-4">
            <div className="flex items-center gap-3">
              <IconChip tone="bakar">
                <Percent />
              </IconChip>
              <p className="min-w-0 flex-1 text-[0.9375rem] leading-snug font-semibold">
                {t("settings:exerciseCredit.pct.title")}
              </p>
              <Stepper
                label={t("settings:exerciseCredit.pct.aria")}
                text={t("settings:exerciseCredit.pct.value", { pct: settings.pct })}
                canDecrease={settings.pct > ADD_BACK_PCT.min}
                canIncrease={settings.pct < ADD_BACK_PCT.max}
                onStep={stepPct}
              />
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("settings:exerciseCredit.pct.hint")}
            </p>
          </div>
        )}
      </Card>
      {settings.enabled ? (
        <>
          <Card className="mt-3 space-y-2">
            <p className="text-sm leading-relaxed text-muted-foreground">{t("energy:credit.pct.body")}</p>
            <p className="text-sm leading-relaxed font-semibold tabular-nums">
              {t("energy:credit.pct.example", {
                pct: settings.pct,
                added: fmtInt((EXAMPLE_EXTRA_KCAL * settings.pct) / 100),
              })}
            </p>
          </Card>
          <Card className="mt-3 space-y-2">
            <FieldLabel>{t("settings:exerciseCredit.cap.title")}</FieldLabel>
            <Segmented<`${AddBackCap}`>
              label={t("settings:exerciseCredit.cap.aria")}
              className="flex-wrap rounded-3xl"
              value={`${settings.cap}`}
              onChange={(value) => {
                const cap = ADD_BACK_CAPS.find((candidate) => `${candidate}` === value) ?? settings.cap;
                save("exercise.addBack.cap", cap, { cap });
              }}
              options={ADD_BACK_CAPS.map((cap) => ({
                value: `${cap}` as `${AddBackCap}`,
                label:
                  cap === "none"
                    ? t("settings:exerciseCredit.cap.none")
                    : t("settings:exerciseCredit.cap.kcal", { kcal: fmtInt(cap) }),
              }))}
            />
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">{t("settings:exerciseCredit.cap.hint")}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{t("energy:credit.cap.body")}</p>
            <p className="text-sm leading-relaxed font-semibold tabular-nums">
              {settings.cap === "none"
                ? t("energy:credit.cap.exampleNone", { pct: settings.pct })
                : t("energy:credit.cap.example", { cap: fmtInt(settings.cap) })}
            </p>
          </Card>
        </>
      ) : (
        <p className="mt-3 rounded-2xl bg-muted px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          {t("energy:credit.off")}
        </p>
      )}
    </>
  );
}
