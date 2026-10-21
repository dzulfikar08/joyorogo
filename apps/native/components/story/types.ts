import type { ChallengeShare } from "@joyorogo/api/lib/challenge";
import type { MealStory as RogoMealStory, PeriodStory, ProgressStory, RecapStory, WorkoutStory } from "@joyorogo/sticker";

export type { PeriodStory, ProgressStory, RecapStory, WorkoutStory };

/** The engine's meal plus the private original photo to fetch with the session (the cutout is `photoUri`). */
export type MealStory = RogoMealStory & { photoId?: string | null };

/** Group challenge result; numbers come from challenge.detail's `share`. */
export type ChallengeStory = ChallengeShare & { kind: "challenge"; date?: Date };

/** What a screen hands to the share sheet; `buildStickerData` turns it into sticker bindings. */
export type StorySpec = MealStory | WorkoutStory | ProgressStory | RecapStory | PeriodStory | ChallengeStory;
