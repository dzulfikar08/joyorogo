import { useQuery } from "@tanstack/react-query";

import { MEAL_EDIT_LABELS, MEALS, effectiveRamadan, slotsFor } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";

import { Chip } from "@/components/chip";
import { FieldLabel } from "@/components/kit/surface";
import { orpc } from "@/utils/orpc";

/**
 * "Waktu makan" chips for the plate and food edit sheets: Sarapan, Makan
 * siang, Makan malam, Camilan, plus Sahur / Berbuka in Ramadan mode. A slot
 * the row already has stays visible even when it is off-season.
 */
export function MealSlotField({
  id,
  value,
  current,
  onChange,
  hint,
}: {
  id: string;
  value: Meal;
  /** Slot stored today; shown even outside the active slot set. */
  current: Meal;
  onChange: (meal: Meal) => void;
  hint: string;
}) {
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const active = slotsFor(effectiveRamadan(profile.data?.profile?.ramadanMode));
  const options = MEALS.filter((meal) => active.includes(meal) || meal === current);
  return (
    <div>
      <FieldLabel htmlFor={id}>Waktu makan</FieldLabel>
      <div className="mt-1.5 space-y-2">
        <div id={id} role="group" aria-label="Waktu makan" className="flex flex-wrap gap-2">
          {options.map((meal) => (
            <Chip key={meal} active={value === meal} onClick={() => onChange(meal)}>
              {MEAL_EDIT_LABELS[meal]}
            </Chip>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
