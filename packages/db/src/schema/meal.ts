import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// "Rencana makan" (Pro): the meal planner. Dates are WIB calendar days 'YYYY-MM-DD'.
// Contract and algorithm: docs/meal-plan.md, planner in packages/api/src/lib/meal/.

/** What a person never wants on their plan: allergens (hard filter), free-text dislikes, and two soft preferences. */
export const mealPrefs = sqliteTable("meal_prefs", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  // JSON string[] of lib/meal/types ALLERGENS
  allergens: text("allergens").notNull().default("[]"),
  // JSON string[] of lowercase free-text words (an ingredient, a dish)
  dislikes: text("dislikes").notNull().default("[]"),
  budgetFriendly: integer("budget_friendly", { mode: "boolean" }).notNull().default(false),
  // 'mixed' | 'cook' (only dishes practical at home) | 'buy' (only dishes found ready-made). Rows from before the
  // three-way choice hold 'any' / 'warung'; readPrefs maps them to 'mixed' / 'buy'.
  cookPref: text("cook_pref").notNull().default("any"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * A saved 7-day plan, starting on `start_date`. `days_json` holds the chosen recipes (references and portion factors,
 * never nutrition: that is computed from TKPI when the plan is read), so the plan stays the same on every open until
 * the person asks for another one. `seed` + `generation` make a regeneration reproducible.
 */
export const mealPlan = sqliteTable(
  "meal_plan",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(),
    seed: text("seed").notNull(),
    generation: integer("generation").notNull().default(1),
    // JSON PlannedDay[] (lib/meal/types) plus per-day budget snapshot
    daysJson: text("days_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.startDate] })],
);

/** One "Ganti": what a slot had and what it became. A swapped-away item is not offered again for that slot and day. */
export const mealPlanSwap = sqliteTable(
  "meal_plan_swap",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    slot: text("slot").notNull(),
    fromRef: text("from_ref").notNull(),
    toRef: text("to_ref").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("meal_plan_swap_user_date_idx").on(table.userId, table.date)],
);

/** Ticked rows of the shopping list of the plan that starts on `start_date` (key = ingredient key). */
export const mealShoppingCheck = sqliteTable(
  "meal_shopping_check",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(),
    itemKey: text("item_key").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.startDate, table.itemKey] })],
);

export type MealPrefsRow = typeof mealPrefs.$inferSelect;
export type MealPlanRow = typeof mealPlan.$inferSelect;
