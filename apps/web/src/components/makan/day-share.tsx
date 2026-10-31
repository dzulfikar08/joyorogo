import { buildDayShare, dayShareStickerIds, type DayShareRow } from "@joyorogo/api/lib/day-share";
import { MEAL_LABELS, type Meal } from "@joyorogo/api/lib/engine";
import { Button } from "@joyorogo/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Share2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ShareStoryButton } from "@/components/story/share-story-button";
import { stickerUrl } from "@/components/sticker";
import { orpc } from "@/utils/orpc";

/** How long one cutout gets to load before the share falls back to the next best one. */
const PREFLIGHT_MS = 8000;

const DAY_KINDS = ["dayfood"];
const NONE: ReadonlySet<string> = new Set();

/**
 * Whether a cutout loads the way the painter will load it (credentialed fetch). Never rejects: a 404 (sticker still
 * being cut), a network error and the timeout all count as "failed".
 */
async function cutoutLoads(url: string): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PREFLIGHT_MS);
  try {
    const res = await fetch(url, { credentials: "include", signal: abort.signal });
    if (!res.ok) return false;
    await res.blob();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** The scan ids whose cutout does not load, checked in parallel. */
async function failedCutouts(ids: readonly string[]): Promise<Set<string>> {
  const loads = await Promise.all(ids.map((id) => cutoutLoads(stickerUrl(id))));
  return new Set(ids.filter((_, index) => !loads[index]));
}

/**
 * "Bagikan makanku sehari": a round share icon beside the day switcher (its `trailing` slot) that shares the whole
 * diary day (a story or a carousel, drawn by the sticker engine). Every cutout the share would draw is checked first,
 * so a plate cutout that is still being cut falls back to its foods' cutouts (or to text only) instead of a broken
 * image. The icon turns into a spinner meanwhile and opens the share sheet once the check is done.
 */
export function DayShareButton({
  date,
  rows,
  eatenKcal,
  eatKcal,
  proteinTargetG,
  macros,
  maternal,
  gain,
  slots,
}: {
  /** YYYY-MM-DD, the diary day. */
  date: string;
  /** Every food row of the day (not the kind-filtered list). */
  rows: readonly DayShareRow[];
  /** What the diary header shows as eaten. */
  eatenKcal: number;
  eatKcal: number | null;
  proteinTargetG: number | null;
  /** The server's personal carb / fat / fibre targets (`day.summary.macros`). */
  macros: { carbsTargetG: number; fatTargetG: number; fiberTargetG: number } | null;
  maternal: boolean;
  gain: boolean;
  /** The diary's visible slots, in order. */
  slots: readonly string[];
}) {
  const { t } = useTranslation("makan");
  const plates = useQuery(orpc.plate.byDate.queryOptions({ input: { date } }));
  const [failed, setFailed] = useState<ReadonlySet<string>>(NONE);
  const [busy, setBusy] = useState(false);
  const slotsKey = slots.join(",");
  const plateRows = plates.data;

  const story = useMemo(() => {
    return buildDayShare({
      date,
      rows,
      plateNames: Object.fromEntries((plateRows ?? []).map((plate) => [plate.id, plate.name])),
      slots: slotsKey.split(","),
      mealLabel: (meal) => MEAL_LABELS[meal as Meal] ?? meal,
      stickerUrl,
      failedStickers: failed,
      eatenKcal,
      targets: {
        kcal: eatKcal,
        proteinG: proteinTargetG,
        carbsG: macros?.carbsTargetG ?? null,
        fatG: macros?.fatTargetG ?? null,
        fiberG: macros?.fiberTargetG ?? null,
      },
      maternal,
      gain,
    });
  }, [date, rows, plateRows, slotsKey, failed, eatenKcal, eatKcal, proteinTargetG, macros, maternal, gain]);

  const begin = async (open: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      setFailed(await failedCutouts(dayShareStickerIds(rows)));
      open();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ShareStoryButton
      story={story}
      initialKind="dayfood"
      kinds={DAY_KINDS}
      renderTrigger={(open) => (
        <Button
          variant="ghost"
          size="icon-lg"
          className="rounded-full bg-muted text-muted-foreground hover:bg-card hover:text-foreground"
          aria-label={t("story.share.shareDay")}
          title={t("story.share.shareDay")}
          aria-busy={busy || undefined}
          onClick={() => void begin(open)}
        >
          {busy ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Share2 aria-hidden />
          )}
        </Button>
      )}
    />
  );
}
