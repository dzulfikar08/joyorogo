import { useTranslation } from "react-i18next";

import type { MealPlanItem } from "@/lib/api-types";

/** What kind of meal it is. The cost label next to it already says "Hemat", so the budget tag is left out. */
export function TagList({ tags }: { tags: MealPlanItem["tags"] }) {
  const { t } = useTranslation("mealPlan");
  const shown = tags.filter((tag) => tag !== "budget");
  if (shown.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {shown.map((tag) => (
        <li
          key={tag}
          className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
        >
          {t(`tag.${tag}`)}
        </li>
      ))}
    </ul>
  );
}
