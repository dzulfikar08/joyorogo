import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { GainInfo } from "@joyorogo/api/lib/gain";
import { cn } from "@joyorogo/ui/lib/utils";

const NOTE_KEY = {
  BMI_LOW: "bmiLow",
  RAPID_LOSS: "rapidLoss",
  TARGET_ABOVE_HEALTHY: "aboveHealthy",
} as const;

/** Neutral info cards for the Naikin BB plan flags. Never alarm-coloured, never blocking. */
export function GainNotes({ gain, className }: { gain: GainInfo; className?: string }) {
  const { t } = useTranslation("gain");
  if (gain.flags.length === 0) return null;
  return (
    <ul className={cn("space-y-2", className)}>
      {gain.flags.map((flag) => {
        const key = NOTE_KEY[flag];
        const bmi = (flag === "TARGET_ABOVE_HEALTHY" ? gain.targetBmi : gain.bmi).toFixed(1);
        return (
          <li
            key={flag}
            className="flex items-start gap-2.5 rounded-2xl bg-muted px-4 py-3 text-sm leading-snug text-muted-foreground"
          >
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <span className="block font-semibold text-foreground">{t(`notes.${key}.title`)}</span>
              {t(`notes.${key}.body`, { bmi })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** "Bukan alat medis": a single quiet line. */
export function GainDisclaimer({ short = false, className }: { short?: boolean; className?: string }) {
  const { t } = useTranslation("gain");
  if (short) {
    return (
      <p className={cn("flex items-start gap-1.5 text-xs leading-snug text-muted-foreground", className)}>
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        {t("notes.disclaimer")}
      </p>
    );
  }
  return (
    <div className={cn("rounded-2xl bg-muted p-4", className)}>
      <p className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t("notes.disclaimer")}
      </p>
    </div>
  );
}
