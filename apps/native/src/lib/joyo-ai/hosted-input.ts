import { ANSWER_LIMITS } from "@joyorogo/api/lib/joyo-ai/answer";
import type { ChatLine } from "@joyorogo/api/lib/joyo-ai/safety";

/** What the hosted server accepts of a message (`joyoChatInputSchema`). */
export const HOSTED_MESSAGE_CHARS = 2_000;

/** The conversation as the hosted chat takes it: the last 12 turns, 2,000 characters each, starting with a question from the person. */
export function hostedMessages(history: readonly ChatLine[]): ChatLine[] {
  const recent = history
    .slice(-ANSWER_LIMITS.turns)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, HOSTED_MESSAGE_CHARS) }));
  while (recent.length > 0 && recent[0]!.role !== "user") recent.shift();
  return recent;
}
