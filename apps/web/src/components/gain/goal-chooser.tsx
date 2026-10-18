import { useTranslation } from "react-i18next";

import type { Goal } from "@joyorogo/api/lib/gain";
import { GOALS } from "@joyorogo/api/lib/gain";

import { Segmented } from "@/components/kit/surface";

/** "Turunin BB / Jaga BB / Naikin BB" with the one-line hint of the chosen goal under it. */
export function GoalChooser({ value, onChange }: { value: Goal; onChange: (goal: Goal) => void }) {
  const { t } = useTranslation("gain");
  return (
    <div className="space-y-2">
      <Segmented
        label={t("goal.title")}
        value={value}
        onChange={onChange}
        options={GOALS.map((goal) => ({ value: goal, label: t(`goal.${goal}`) }))}
      />
      <p className="px-1 text-sm leading-snug text-muted-foreground">{t(`goal.hint.${value}`)}</p>
    </div>
  );
}
