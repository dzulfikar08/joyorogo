import { Input } from "@joyorogo/ui/components/input";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  EATEN_AT_MAX_FUTURE_MS,
  defaultEatenAt,
  eatenAtClock,
  eatenAtFromClock,
  eatenAtNudge,
  eatenAtPresets,
} from "@joyorogo/api/lib/eaten-at";

import { Chip } from "@/components/chip";
import { FieldLabel } from "@/components/kit/surface";

/**
 * "Jam makan" for every add and edit flow. `null` means now and nothing is sent, so one-tap logging stays one tap.
 * Chips: Sekarang, the parts of the day already behind us (Tadi pagi / siang / malam) and a time input (clock of the
 * diary day `date` in the day zone). When the meal slot does not suit the clock right now (Sarapan at 21:00) a
 * one-tap "Jam makan sebenarnya?" opens the input on that slot's usual time. `value` is unix ms or null.
 */
export function EatenAtField({
  id,
  date,
  meal,
  value,
  onChange,
}: {
  id: string;
  /** Diary day (key in the day zone) the time must fall on. */
  date: string;
  meal: string;
  value: number | null;
  onChange: (eatenAt: number | null) => void;
}) {
  const { t } = useTranslation("makan");
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const presets = eatenAtPresets(date, now);
  const nudge = value === null ? eatenAtNudge(date, meal, now) : null;
  const preset = presets.find((p) => p.eatenAt === value);
  const custom = value !== null && !preset;
  const choose = (next: number | null) => {
    setError(null);
    onChange(next);
  };
  const open = (start: number) => {
    setTyping(true);
    if (value === null) choose(start);
  };
  const clock = value === null ? "" : eatenAtClock(value);
  return (
    <div>
      <FieldLabel htmlFor={id}>{t("eatenAt.label")}</FieldLabel>
      <div className="mt-1.5 space-y-2">
        <div role="group" aria-label={t("eatenAt.label")} className="flex flex-wrap gap-2">
          <Chip
            active={value === null && !typing}
            onClick={() => {
              setTyping(false);
              choose(null);
            }}
          >
            {t("eatenAt.now")}
          </Chip>
          {presets.map((p) => (
            <Chip
              key={p.key}
              active={preset?.key === p.key}
              onClick={() => {
                setTyping(false);
                choose(p.eatenAt);
              }}
            >
              {t(`eatenAt.${p.key}`)}
            </Chip>
          ))}
          <Chip active={custom || typing} onClick={() => open(nudge ?? defaultEatenAt(date, meal))}>
            {custom ? clock : t("eatenAt.pick")}
          </Chip>
        </div>
        {typing || custom ? (
          <Input
            id={id}
            type="time"
            value={clock}
            aria-label={t("eatenAt.sheetTitle")}
            onChange={(event) => {
              const text = event.target.value;
              if (text === "") {
                setTyping(false);
                return choose(null);
              }
              const ms = eatenAtFromClock(date, text);
              if (ms === null) return;
              if (ms > Date.now() + EATEN_AT_MAX_FUTURE_MS) setError(t("eatenAt.future"));
              else choose(ms);
            }}
            className="w-32"
          />
        ) : null}
        {nudge !== null && !typing ? (
          <button
            type="button"
            onClick={() => open(nudge)}
            className="rounded-full text-sm font-semibold text-foreground underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            {t("eatenAt.nudge")}
          </button>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("eatenAt.hint")}</p>
      </div>
    </div>
  );
}
