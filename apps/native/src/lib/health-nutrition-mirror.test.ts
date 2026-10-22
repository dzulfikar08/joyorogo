// The Health Connect nutrition mirror: which food calls reach it, and what a record carries.
import { beforeAll, describe, expect, mock, test } from "bun:test";

const written: string[][] = [];
const deleted: string[] = [];

mock.module("react-native", () => ({ Platform: { OS: "android" } }));
mock.module("@/utils/orpc", () => ({ client: {} }));
mock.module("react-native-health-connect", () => ({
  initialize: async () => true,
  getGrantedPermissions: async () => [{ recordType: "Nutrition", accessType: "write" }],
  requestPermission: async () => [],
  insertRecords: async (records: Array<{ metadata: { clientRecordId: string } }>) => {
    written.push(records.map((r) => r.metadata.clientRecordId));
    return records.map((_, i) => String(i));
  },
  deleteRecordsByUuids: async (_type: string, _ids: string[], clientIds: string[]) => {
    deleted.push(...clientIds);
  },
}));

let nutrition: typeof import("./health-connect-nutrition");
let mirror: typeof import("./health-nutrition");
beforeAll(async () => {
  nutrition = await import("./health-connect-nutrition");
  mirror = await import("./health-nutrition");
});

const row = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  date: "2026-10-20",
  meal: "makan_siang",
  name: "Nasi",
  kcal: 200,
  protein: 4,
  carbs: 44,
  fat: 0,
  fiber: null,
  createdAt: new Date("2026-10-20T05:00:00Z"),
  ...over,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("toNutritionRecord", () => {
  test("a real 0 g is written as 0, an unknown (null) macro is left out", () => {
    const record = nutrition.toNutritionRecord(row(), 1);
    expect(record.totalFat).toEqual({ value: 0, unit: "grams" });
    expect(record.protein).toEqual({ value: 4, unit: "grams" });
    expect(record.dietaryFiber).toBeUndefined();
  });

  test("the record starts at the time the person set (eatenAt) when it falls on the meal's day", () => {
    const eatenAt = new Date("2026-10-20T01:30:00Z").getTime();
    const start = nutrition.toNutritionRecord(row({ eatenAt }), 1).startTime;
    expect(new Date(start).getTime()).toBe(eatenAt);
    // an eatenAt of another day is ignored, the log time is used
    const stale = new Date("2026-10-10T01:30:00Z").getTime();
    expect(new Date(nutrition.toNutritionRecord(row({ eatenAt: stale }), 1).startTime).getTime()).toBe(
      new Date("2026-10-20T05:00:00Z").getTime(),
    );
  });
});

describe("mirrorFoodCall reaches every path that logs or removes a diary row", () => {
  test.each([
    ["savedFood", "relog", { items: [row({ id: "fav1" })] }],
    ["place", "relog", { items: [row({ id: "pl1" }), row({ id: "pl2" })] }],
    ["mealPlan", "eat", { row: row({ id: "plan1" }) }],
  ])("%s.%s is written", async (router, op, output) => {
    written.length = 0;
    mirror.mirrorFoodCall([router, op], {}, output);
    await settle();
    const ids = (output as { items?: Array<{ id: string }>; row?: { id: string } }).items?.map((r) => r.id) ?? [(output as { row: { id: string } }).row.id];
    expect(written.flat()).toEqual(ids.map((id) => `joyorogo:meal:${id}`));
  });

  test("mealPlan.undoEat removes the record, and an old server without removedLogId does nothing", async () => {
    deleted.length = 0;
    mirror.mirrorFoodCall(["mealPlan", "undoEat"], {}, { days: [], removedLogId: "meal-plan:u:2026-10-20:sarapan" });
    await settle();
    expect(deleted).toEqual(["joyorogo:meal:meal-plan:u:2026-10-20:sarapan"]);
    deleted.length = 0;
    mirror.mirrorFoodCall(["mealPlan", "undoEat"], {}, { days: [] });
    await settle();
    expect(deleted).toEqual([]);
  });

  test("other routers and procedures stay out", async () => {
    written.length = 0;
    mirror.mirrorFoodCall(["savedFood", "list"], {}, { items: [row()] });
    mirror.mirrorFoodCall(["place", "list"], {}, { items: [row()] });
    mirror.mirrorFoodCall(["weight", "add"], {}, row());
    await settle();
    expect(written).toEqual([]);
  });
});
