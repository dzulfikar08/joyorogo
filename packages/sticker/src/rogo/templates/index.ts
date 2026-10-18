import type { TemplateInput } from "../../core/schema";
import { withStickerMark } from "../kit";
import { CHALLENGE_TEMPLATES } from "./challenge";
import { DAY_TEMPLATES } from "./day";
import { MEAL_TEMPLATES } from "./meal";
import { MILESTONE_TEMPLATES } from "./milestone";
import { STREAK_TEMPLATES } from "./streak";
import { WEEK_TEMPLATES } from "./week";
import { WEIGHT_TEMPLATES } from "./weight";
import { WORKOUT_TEMPLATES } from "./workout";

const AUTHORED: TemplateInput[] = [
  ...DAY_TEMPLATES,
  ...MEAL_TEMPLATES,
  ...STREAK_TEMPLATES,
  ...WEIGHT_TEMPLATES,
  ...WEEK_TEMPLATES,
  ...CHALLENGE_TEMPLATES,
  ...WORKOUT_TEMPLATES,
  ...MILESTONE_TEMPLATES,
];

/** Every built-in JoyoRogo sticker, as authored plus the shared sticker mark. */
export const ROGO_TEMPLATE_SOURCES: TemplateInput[] = AUTHORED.map(withStickerMark);
