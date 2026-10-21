import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { Link } from "@tanstack/react-router";
import { Camera, Mic, ScanBarcode } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Chip } from "@/components/chip";
import { FavoritChips } from "@/components/favorit";
import type { Favorites } from "@/components/favorit";
import { Card } from "@/components/kit/surface";
import { CutoutTile } from "@/components/sticker";
import type { FoodAddInput, FoodRecentItem } from "@/lib/api-types";
import { fmtDateLong, fmtInt } from "@/lib/format";

const ACTION =
  "flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-2xl bg-muted px-2 py-2.5 text-sm font-semibold transition-colors hover:bg-border focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

function Action({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <>
      <span aria-hidden className="text-makan-ink">
        {icon}
      </span>
      {children}
    </>
  );
}

/**
 * Quick-add card on Daftar: photo, barcode and story actions, then favorites
 * and recent foods as one-tap chips that log to the suggested slot of the
 * viewed day. The slot "+" still opens the full add sheet.
 */
export function QuickAddCard({
  date,
  isToday,
  meal,
  favorites,
  recent,
  addPending,
  onAdd,
  onStory,
  onManage,
}: {
  date: string;
  isToday: boolean;
  /** Slot the chips log to (suggestMealNow). */
  meal: Meal;
  favorites: Favorites;
  recent: FoodRecentItem[];
  addPending: boolean;
  onAdd: (input: FoodAddInput) => void;
  onStory: () => void;
  onManage: () => void;
}) {
  const { t } = useTranslation("makan");
  const mealLabel = MEAL_LABELS[meal];
  return (
    <Card aria-label={t("diary.quick.label")} className="p-4">
      <h2 className="px-1 text-base font-bold tracking-tight">{t("diary.quick.label")}</h2>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Link to="/makan/ai" search={isToday ? {} : { date }} className={ACTION}>
          <Action icon={<Camera className="size-5" />}>{t("diary.quick.photo")}</Action>
        </Link>
        <Link
          to="/makan/barcode"
          search={{ ...(isToday ? {} : { date }), meal }}
          className={ACTION}
        >
          <Action icon={<ScanBarcode className="size-5" />}>{t("diary.quick.barcode")}</Action>
        </Link>
        <button type="button" onClick={onStory} className={ACTION}>
          <Action icon={<Mic className="size-5" />}>{t("diary.quick.story")}</Action>
        </button>
      </div>

      {favorites.items.length > 0 && (
        <div className="mt-4">
          <p className="px-1 text-xs text-muted-foreground">
            {isToday
              ? t("diary.favorites.inlineHint", { meal: mealLabel })
              : t("diary.favorites.inlineHintOnDate", { meal: mealLabel, date: fmtDateLong(date) })}
          </p>
          <div className="mt-2">
            <FavoritChips favorites={favorites} date={date} meal={meal} onManage={onManage} />
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-4">
          <p className="px-1 text-xs text-muted-foreground">
            {t("diary.quick.recent", { meal: mealLabel })}
          </p>
          <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
            {recent.map((food) => (
              <Chip
                key={food.name}
                disabled={addPending}
                className={food.scanId ? "max-w-[16rem] shrink-0 gap-2 pl-1.5" : "max-w-[16rem] shrink-0"}
                onClick={() => onAdd({ date, meal, name: food.name, kcal: food.kcal })}
              >
                {food.scanId ? (
                  <CutoutTile scanId={food.scanId} className="size-8 rounded-lg" iconClassName="size-4" />
                ) : null}
                <span className="truncate">
                  {food.name} · {fmtInt(food.kcal)} {t("diary.summary.unit")}
                </span>
              </Chip>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
