import { describe, expect, test } from "bun:test";

import { setupChecklist } from "./setup-checklist";

describe("setupChecklist", () => {
  test("finished rows sink, open ones keep the offered order", () => {
    const list = setupChecklist({ meal: true, weigh: false, source: false }, false, 3);
    expect(list?.rows.map((row) => row.id)).toEqual(["weigh", "source", "meal"]);
    expect(list?.doneCount).toBe(1);
    expect(list?.total).toBe(3);
  });

  test("nothing is shown while a step is still being detected", () => {
    expect(setupChecklist({ meal: true, weigh: null, source: false }, false, 3)).toBeNull();
  });

  test("nothing is shown before the dismissal is read, or after it", () => {
    expect(setupChecklist({ meal: false, weigh: false, source: false }, null, 3)).toBeNull();
    expect(setupChecklist({ meal: false, weigh: false, source: false }, true, 3)).toBeNull();
  });

  test("an old account that already logs and weighs in is not nagged for a source", () => {
    const state = { meal: true, weigh: true, source: false };
    expect(setupChecklist(state, false, 200)).toBeNull();
    expect(setupChecklist(state, false, 3)?.rows.map((row) => row.id)).toEqual(["source", "meal", "weigh"]);
    expect(setupChecklist({ ...state, meal: false }, false, 200)).not.toBeNull();
  });

  test("gone once every step is done", () => {
    expect(setupChecklist({ meal: true, weigh: true, source: true }, false, 3)).toBeNull();
  });
});
