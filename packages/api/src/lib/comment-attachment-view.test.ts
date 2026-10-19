import { describe, expect, test } from "bun:test";

import { attachmentFacts } from "./comment-attachment-view";

describe("attachmentFacts", () => {
  test("a run reads distance first, then time, energy and heart rate", () => {
    const facts = attachmentFacts("workout", { durationMin: 32, kcal: 310, distanceM: 6200, avgHr: 148, sportKind: "run" }, "id");
    expect(facts).toEqual([
      { key: "distance", params: { value: "6,2" } },
      { key: "duration", params: { value: "32" } },
      { key: "kcal", params: { value: "310" } },
      { key: "heartRate", params: { value: "148" } },
    ]);
  });

  test("missing and zero numbers are left out, never shown as 0", () => {
    expect(attachmentFacts("workout", { durationMin: 20, kcal: null, distanceM: 0, avgHr: null }, "en")).toEqual([
      { key: "duration", params: { value: "20" } },
    ]);
    expect(attachmentFacts("image", {}, "en")).toEqual([]);
  });

  test("weight keeps its sign and follows the locale's decimal mark", () => {
    expect(attachmentFacts("weight", { weightKg: 68.4, deltaKg: -1.6 }, "id")).toEqual([
      { key: "weight", params: { value: "68,4" } },
      { key: "delta", params: { value: "-1,6" } },
    ]);
    expect(attachmentFacts("weight", { weightKg: 70, deltaKg: 0.4 }, "en")[1]).toEqual({ key: "delta", params: { value: "+0.4" } });
  });

  test("a meal shows the item count only for a plate", () => {
    expect(attachmentFacts("food", { kcal: 350, protein: 16, carbs: 52, fat: 8, items: 1 }, "en").map((f) => f.key)).toEqual(["kcal", "protein", "carbs", "fat"]);
    expect(attachmentFacts("food", { kcal: 350, items: 3 }, "en").map((f) => f.key)).toEqual(["kcal", "items"]);
  });

  test("a recap puts the average against the target and the days on target against the logged days", () => {
    const facts = attachmentFacts(
      "recap",
      { avgKcal: 1850, targetKcal: 2000, daysOnTarget: 4, loggedDays: 6, streakDays: 5, exerciseMin: 90, weightChangeKg: -0.5 },
      "id",
    );
    expect(facts[0]).toEqual({ key: "avgKcal", params: { value: "1.850", target: "2.000" } });
    expect(facts[1]).toEqual({ key: "onTarget", params: { days: "4", total: "6" } });
    expect(facts.map((f) => f.key)).toEqual(["avgKcal", "onTarget", "streak", "exercise", "weightChange"]);
  });
});
