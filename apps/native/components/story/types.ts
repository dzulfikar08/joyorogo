import type { ChallengeShare } from "@joyorogo/api/lib/challenge";
import type { MealStory, ProgressStory, RecapStory, WorkoutStory } from "@joyorogo/sticker";

export type { MealStory, ProgressStory, RecapStory, WorkoutStory };

/** Group challenge result; numbers come from challenge.detail's `share`. */
export type ChallengeStory = ChallengeShare & { kind: "challenge"; date?: Date };

/** What a screen hands to the share sheet; `buildStickerData` turns it into sticker bindings. */
export type StorySpec = MealStory | WorkoutStory | ProgressStory | RecapStory | ChallengeStory;
