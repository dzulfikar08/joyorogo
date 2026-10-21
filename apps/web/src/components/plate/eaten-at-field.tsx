import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { eatenAtClock, eatenAtFromClock } from "@joyorogo/api/lib/eaten-at";

import { FieldLabel } from "@/components/kit/surface";

/**
 * Optional "Jam makan" row for the add and edit flows. No value means "now" and
 * nothing is sent, so one-tap logging stays one tap. `value` is unix ms or null;
 * the time is read on the clock of the diary day `date`.
 */
export function EatenAtField({
  id,
  date,
  value,
  onChange,
}: {
  id: string;
  /** Diary day (key in the day zone) the time must fall on. */
  date: string;
  value: number | null;
  onChange: (eatenAt: number | null) => void;
}) {
  const { t } = useTranslation("makan");
  const clock = value === null ? "" : eatenAtClock(value);
  return (
    <div>
      <FieldLabel htmlFor={id}>{t("eatenAt.label")}</FieldLabel>
      <div className="mt-1.5 flex items-center gap-2">
        <Input
          id={id}
          type="time"
          value={clock}
          onChange={(event) => {
            const text = event.target.value;
            if (text === "") return onChange(null);
            const ms = eatenAtFromClock(date, text);
            if (ms !== null) onChange(ms);
          }}
          className="w-32"
        />
        {clock ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            <X aria-hidden />
            {t("eatenAt.clear")}
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">{t("eatenAt.now")}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("eatenAt.hint")}</p>
    </div>
  );
}
