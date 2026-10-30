import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { Meal } from "@joyorogo/api/lib/engine";
import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import {
  buildDayShare,
  dayShareStickerIds,
  type DayShare,
  type DayShareInput,
  type DayShareRow,
} from "@joyorogo/api/lib/day-share";

import { PressableScale } from "@/components/motion";
import { stickerUrl } from "@/components/sticker";
import { StoryShareSheet } from "@/components/story/share-story-button";

/** How long one cutout gets to load before the share draws without it. */
const PREFLIGHT_MS = 8_000;

function cutoutLoads(url: string): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const timer = setTimeout(() => resolve(false), PREFLIGHT_MS);
  Image.prefetch(url)
    .catch(() => false)
    .then((ok) => {
      clearTimeout(timer);
      resolve(ok);
    });
  return promise;
}

/**
 * The cutouts a day share would draw that do not load (a plate cutout is cut in the background, so it can still 404
 * right after a scan). Checked in parallel, up front: the share sheet is gated on every image loading, so a cutout
 * that cannot load would leave the whole share stuck. The builder falls back from these (plate -> its foods -> text).
 */
async function failedCutouts(rows: readonly DayShareRow[]): Promise<Set<string>> {
  const ids = dayShareStickerIds(rows);
  const loads = await Promise.all(ids.map((id) => cutoutLoads(stickerUrl(id))));
  return new Set(ids.filter((_, index) => !loads[index]));
}

type DayShareButtonProps = Omit<
  DayShareInput,
  "mealLabel" | "stickerUrl" | "failedStickers" | "rows" | "plateNames"
> & {
  rows: readonly DayShareRow[];
  plateNames: Readonly<Record<string, string>>;
};

/**
 * "Bagikan makanku sehari": a round share icon beside the day switcher that opens the share sheet on the whole day.
 * The cutouts are checked first (spinner in the circle), and the sheet only opens once they are known to load.
 */
export function DayShareButton(props: DayShareButtonProps) {
  const { t } = useTranslation(["makan"]);
  const { theme } = useUnistyles();
  const [busy, setBusy] = useState(false);
  const [story, setStory] = useState<DayShare | null>(null);
  const [open, setOpen] = useState(false);
  // The day on screen right now: a day switch while the cutouts are being checked drops the share.
  const liveDate = useRef(props.date);
  liveDate.current = props.date;
  const label = t("story.share.shareDay");

  const start = async () => {
    if (busy) return;
    const input = props;
    setBusy(true);
    let failedStickers = new Set<string>();
    try {
      failedStickers = await failedCutouts(input.rows);
    } catch (error) {
      console.warn("day share cutout preflight failed", error);
    }
    setBusy(false);
    if (liveDate.current !== input.date) return;
    setStory(
      buildDayShare({
        ...input,
        mealLabel: (meal) => MEAL_LABELS[meal as Meal] ?? meal,
        stickerUrl,
        failedStickers,
      }),
    );
    setOpen(true);
  };

  return (
    <>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={() => void start()}
        style={styles.control}
        dimTo={0.75}
        scaleTo={0.97}
      >
        {busy ? (
          <ActivityIndicator size="small" color={theme.colors.foreground} />
        ) : (
          <Ionicons name="share-outline" size={20} color={theme.colors.foreground} />
        )}
      </PressableScale>
      {story ? (
        <StoryShareSheet
          story={story}
          open={open}
          onClose={() => setOpen(false)}
          initialKind="dayfood"
          kinds={["dayfood"]}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  control: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
}));
