/** The setup steps the Beranda checklist can show, in the order they are offered. */
export const SETUP_STEPS = ["meal", "weigh", "source"] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number];

/** What the app detected for each step: true done, false open, null not known yet (still loading). */
export type SetupState = Record<SetupStepId, boolean | null>;

export type SetupRow = { id: SetupStepId; done: boolean };

export type SetupChecklist = {
  /** Open steps first, finished ones after; each group keeps the offered order. */
  rows: SetupRow[];
  doneCount: number;
  total: number;
};

/** An account older than this has had its chance at the first steps. */
export const NEW_ACCOUNT_DAYS = 30;

/**
 * The checklist for a detected state, or null when it has nothing to say: a step is still being detected (showing
 * rows that may turn out done would flash), every step is done, the person closed it, or the account is old and
 * already logs and weighs in (a missing activity source alone is not worth a card; the sources screen has it).
 */
export function setupChecklist(
  state: SetupState,
  dismissed: boolean | null,
  accountAgeDays: number | null,
): SetupChecklist | null {
  if (dismissed !== false) return null;
  if (SETUP_STEPS.some((id) => state[id] === null)) return null;
  if (accountAgeDays !== null && accountAgeDays > NEW_ACCOUNT_DAYS && state.meal === true && state.weigh === true) {
    return null;
  }
  const rows = SETUP_STEPS.map((id) => ({ id, done: state[id] === true }));
  const doneCount = rows.filter((row) => row.done).length;
  if (doneCount === rows.length) return null;
  return {
    rows: [...rows.filter((row) => !row.done), ...rows.filter((row) => row.done)],
    doneCount,
    total: rows.length,
  };
}
