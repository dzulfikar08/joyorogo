import type { ChallengeShare } from "@joyorogo/api/lib/challenge";
import { challengeShareText } from "@joyorogo/api/lib/challenge";
import { fmtNumber, i18n } from "@joyorogo/i18n";
import { daysBetween } from "@joyorogo/api/lib/engine";
import type {
  DayFoodStory,
  PeriodStory,
  ProgressStory,
  RecapStory,
  StorySpec as RogoStory,
  WorkoutStory,
} from "@joyorogo/sticker";

import { photoUrl, stickerUrl } from "@/components/sticker";
import { shareUrl } from "@/lib/share-links";

/**
 * What a web screen hands to the share sheet. The sticker engine
 * (packages/sticker) does the drawing; this file only maps screen data to it and
 * writes the caption.
 */

export type MealStory = {
  kind: "meal";
  name: string;
  kcal: number;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  /** One-line reaction under the kcal, e.g. the scan page's "Aman, bro". */
  reaction?: string;
  /** Cutout/original photo of the meal; both keys resolve server-side. */
  scanId?: string | null;
  photoId?: string | null;
  /** Local photo (object URL / data URL) that wins over scanId/photoId. */
  photoSrc?: string | null;
  date?: Date;
};

/** Group challenge result; numbers come from challenge.detail's `share`. */
export type ChallengeStory = { kind: "challenge"; share: ChallengeShare; date?: Date };

export type StorySpec =
  | MealStory
  | WorkoutStory
  | ProgressStory
  | RecapStory
  | PeriodStory
  | ChallengeStory
  | DayFoodStory;

export type StoryImages = { photo: string | null; cutout: string | null };

/** The engine's spec plus the photo and cutout URLs the meal carries. */
export function toRogoSpec(story: StorySpec): { spec: RogoStory; images: StoryImages } {
  if (story.kind === "challenge") {
    return { spec: { ...story.share, kind: "challenge", date: story.date }, images: { photo: null, cutout: null } };
  }
  if (story.kind !== "meal") return { spec: story, images: { photo: null, cutout: null } };
  const photo = story.photoSrc ?? (story.photoId ? photoUrl(story.photoId) : null);
  const cutout = story.scanId ? stickerUrl(story.scanId) : null;
  return {
    spec: {
      kind: "meal",
      name: story.name,
      kcal: story.kcal,
      protein: story.protein,
      carbs: story.carbs,
      fat: story.fat,
      reaction: story.reaction,
      date: story.date,
    },
    images: { photo, cutout },
  };
}

/** Default share copy per card, matching the app's casual voice, ending in a tracked link. */
export function defaultShareText(story: StorySpec): string {
  // The period card is a progress share as far as the tracked link goes; a whole day of food is a meal share.
  const medium = story.kind === "period" ? "progress" : story.kind === "dayfood" ? "meal" : story.kind;
  return `${shareBody(story)}\n${shareUrl("/", medium)}`;
}

function shareBody(story: StorySpec): string {
  if (story.kind === "dayfood") {
    const kcal = fmtNumber(Math.round(story.kcal), 1);
    return story.protein != null
      ? i18n.t("makan:story.card.share.dayfoodProtein", { kcal, protein: fmtNumber(Math.round(story.protein), 1) })
      : i18n.t("makan:story.card.share.dayfood", { kcal });
  }
  if (story.kind === "meal") {
    return i18n.t("makan:story.card.share.meal", {
      name: story.name,
      kcal: fmtNumber(Math.round(story.kcal), 1),
    });
  }
  if (story.kind === "workout") {
    return i18n.t("makan:story.card.share.workout", { name: story.name });
  }
  if (story.kind === "recap") {
    return i18n.t(story.gain ? "gain:recap.shareLine" : "makan:story.card.share.recap", {
      name: story.name,
      on: story.daysOnTarget,
      logged: story.loggedDays,
      avg: fmtNumber(story.avgKcal, 1),
    });
  }
  if (story.kind === "challenge") {
    return challengeShareText(story.share);
  }
  if (story.kind === "period") {
    return i18n.t("makan:story.card.share.period", {
      days: daysBetween(story.from, story.to) + 1,
      logged: story.loggedDays,
      judged: story.judgedDays,
    });
  }
  if (story.gain) {
    const gained = story.weightGainedKg ?? 0;
    return gained > 0
      ? i18n.t("gain:share.gained", { kg: fmtNumber(gained, 1) })
      : i18n.t("gain:share.progress");
  }
  const lost = story.weightLostKg ?? 0;
  return lost > 0
    ? i18n.t("makan:story.card.share.lost", { kg: fmtNumber(lost, 1) })
    : i18n.t("makan:story.card.share.progress");
}
