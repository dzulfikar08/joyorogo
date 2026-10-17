/**
 * Which values a product shows when several users photographed its label.
 *
 * Each user has at most one submission per code (their newest). Two submissions
 * agree when their per-100 numbers are close (label rounding, a misread digit
 * the other user did not make). The submission with the most agreeing others
 * wins and `contributors` is the size of that group; on a tie the newest wins,
 * so a second user who disagrees overrides a lone first submission, and a third
 * settles it. Pure, so the rules are testable without a database.
 */
import type { Per100Values } from "./barcode-nutrition";

export type Submission = Per100Values & {
  /** Null for a user whose account was deleted: still a value, no longer a person. */
  userId: string | null;
  name: string;
  brand: string | null;
  quantity: string | null;
  servingSize: number | null;
  unit: "g" | "ml";
  /** Epoch ms of the user's latest save. */
  at: number;
};

/** Both sides within a relative tolerance, or within a small absolute one for tiny numbers. */
function close(a: number | null, b: number | null, rel: number, abs: number): boolean {
  if (a === null || b === null) return true;
  return Math.abs(a - b) <= Math.max(Math.max(a, b) * rel, abs);
}

/** Do two readings of the same label say the same thing? Unknown nutrients do not disagree. */
export function submissionsAgree(a: Per100Values, b: Per100Values): boolean {
  return (
    close(a.kcal100, b.kcal100, 0.1, 8) &&
    close(a.protein100, b.protein100, 0.15, 1.5) &&
    close(a.carbs100, b.carbs100, 0.15, 2) &&
    close(a.fat100, b.fat100, 0.15, 1.5) &&
    close(a.fiber100, b.fiber100, 0.2, 1) &&
    close(a.sugar100, b.sugar100, 0.2, 1.5)
  );
}

export type Consensus = { winner: Submission; contributors: number };

/** The values to show and how many users stand behind them; null with no submissions. */
export function consensus(submissions: readonly Submission[]): Consensus | null {
  let best: Consensus | null = null;
  for (const candidate of submissions) {
    const support = submissions.filter(
      (other) => other === candidate || submissionsAgree(candidate, other),
    ).length;
    if (
      best === null ||
      support > best.contributors ||
      (support === best.contributors && candidate.at > best.winner.at)
    ) {
      best = { winner: candidate, contributors: support };
    }
  }
  return best;
}
