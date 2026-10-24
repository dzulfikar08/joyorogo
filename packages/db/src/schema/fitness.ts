import { relations, sql } from "drizzle-orm";
import {
  integer,
  index,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// 'male' | 'female'
// 'low' | 'mid' | 'high' — daily-life activity; exercise is logged separately and counted in Burn
// targetDate and date columns hold WIB calendar days as 'YYYY-MM-DD'
export const profile = sqliteTable("profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  shareCode: text("share_code"),
  shareEnabled: integer("share_enabled", { mode: "boolean" }).notNull().default(false),
  // Feed identity: unique handle for /u/<handle> (null = belum dipilih; diisi
  // otomatis saat pertama dibutuhkan). bio maks 160 karakter.
  handle: text("handle"),
  bio: text("bio"),
  // Off: halaman publik cuma menampilkan nama dan postingan tidak bisa 'publik'.
  publicProfile: integer("public_profile", { mode: "boolean" }).notNull().default(true),
  // Peta rute di postingan latihan (polyline sederhana, 200 m awal/akhir dipotong).
  // Off: tidak ada postingan milik pengguna ini yang menampilkan peta, untuk siapa pun.
  shareMaps: integer("share_maps", { mode: "boolean" }).notNull().default(true),
  // Visibility default saat membagikan ke feed: 'grup' | 'publik'.
  defaultVisibility: text("default_visibility", { enum: ["grup", "publik"] })
    .notNull()
    .default("grup"),
  birthYear: integer("birth_year").notNull(),
  gender: text("gender").notNull(),
  heightCm: real("height_cm").notNull(),
  startWeightKg: real("start_weight_kg").notNull(),
  targetWeightKg: real("target_weight_kg").notNull(),
  targetDate: text("target_date").notNull(),
  // The plan's direction, derived from the target vs the weight at the moment it was
  // set (api lib/gain.ts goalOf): 'lose' = deficit toward a lower target (and the
  // implicit hold once reached), 'maintain' = hold, 'gain' = TDEE + surplus toward a
  // higher target. Stored so a later weigh-in below a reached loss target never
  // turns the plan into a gain.
  goal: text("goal", { enum: ["lose", "maintain", "gain"] })
    .notNull()
    .default("lose"),
  // Weight (kg) on the day the goal became 'gain': the baseline of "naik X kg". Null for
  // every other goal, where progress counts from startWeightKg.
  goalStartKg: real("goal_start_kg"),
  // The activity factor of the daily-life level (api lib/engine ACTIVITY_FACTOR): sedentary 1.2, light 1.375, moderate
  // 1.55, active 1.725, very_active 1.9. Migration 0048 renamed the old low / mid / high.
  activityLevel: text("activity_level", { enum: ["sedentary", "light", "moderate", "active", "very_active"] }).notNull(),
  // Nightly sleep goal in hours (api lib/engine SLEEP_TARGET_HOURS: 6 to 9 in half hours). Null = the default, 8.
  sleepTargetHours: real("sleep_target_hours"),
  // Zone this person's calendar days are cut in: Asia/Jakarta | Asia/Kuala_Lumpur | Asia/Singapore (DayZone in
  // @joyorogo/i18n). Null on a profile created before zones: every day it stored is WIB, so null means Asia/Jakarta.
  timezone: text("timezone"),
  // The person's own maintenance kcal ("Pakai TDEE sendiri"): replaces BMR x factor (and the automatic calibration) as
  // the TDEE the plan is built on. Null = the computed TDEE. manualTdeeSetAt is when it was last saved;
  // manualTdeeDismissedOn is the WIB day they answered "Biarkan" to the calibration's suggestion (api lib/manual-tdee).
  manualTdeeKcal: integer("manual_tdee_kcal"),
  manualTdeeSetAt: integer("manual_tdee_set_at", { mode: "timestamp_ms" }),
  manualTdeeDismissedOn: text("manual_tdee_dismissed_on"),
  // Ramadan schedule: 'auto' follows the Hijri calendar, on/off force it.
  ramadanMode: text("ramadan_mode", { enum: ["auto", "on", "off"] })
    .notNull()
    .default("auto"),
  // Opt-in: keep the original photo of saved scans (viewable in the diary).
  // Off by default; turning it off deletes the originals already kept.
  keepPhotos: integer("keep_photos", { mode: "boolean" }).notNull().default(false),
  // Intermittent fasting: 'off' | '16:8' | '18:6' | '20:4' | 'omad'. The eating
  // window opens at fastingWindowStart ('HH:MM' WIB). Ramadan, when in effect,
  // takes precedence over this schedule.
  fastingPattern: text("fasting_pattern", { enum: ["off", "16:8", "18:6", "20:4", "omad"] })
    .notNull()
    .default("off"),
  fastingWindowStart: text("fasting_window_start").notNull().default("12:00"),
  fastingNotify: integer("fasting_notify", { mode: "boolean" }).notNull().default(false),
  // Optional food spending limit in IDR per foodBudgetPeriod ('day' | 'month').
  foodBudgetIdr: integer("food_budget_idr"),
  foodBudgetPeriod: text("food_budget_period", { enum: ["day", "month"] })
    .notNull()
    .default("month"),
  // Saved app language ('id' | 'en' | ...; validated by @joyorogo/i18n in the
  // API). Null = never chosen: clients fall back to their device language.
  locale: text("locale"),
  // Hamil / Menyusui (api lib/maternal.ts). 'none' = the normal weight-loss plan.
  // The mode drops the deficit and the weight target; health data, never shared.
  maternalMode: text("maternal_mode", { enum: ["none", "pregnant", "breastfeeding"] })
    .notNull()
    .default("none"),
  // HPHT (first day of last period) as a WIB day; an entered HPL is stored as HPL - 280 days.
  pregnancyLmp: text("pregnancy_lmp"),
  // What the user typed: 'hpht' | 'hpl'.
  pregnancyDateKind: text("pregnancy_date_kind", { enum: ["hpht", "hpl"] }),
  prePregnancyWeightKg: real("pre_pregnancy_weight_kg"),
  pregnancyTwins: integer("pregnancy_twins", { mode: "boolean" }).notNull().default(false),
  // 'exclusive' | 'partial'
  breastfeedingType: text("breastfeeding_type", { enum: ["exclusive", "partial"] }),
  babyBirthDate: text("baby_birth_date"),
  // JSON array of 'gestational_diabetes' | 'hypertension' | 'anemia'; only triggers a see-your-doctor note.
  maternalConditions: text("maternal_conditions", { mode: "json" }).$type<string[]>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
}, (table) => [uniqueIndex("profile_handle_uidx").on(table.handle)]);

export const weightLog = sqliteTable(
  "weight_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    weightKg: real("weight_kg").notNull(),
    /** Body composition from a Bluetooth scale weigh-in (JoyoFit); all null for manual entries. */
    bodyFatPct: real("body_fat_pct"),
    musclePct: real("muscle_pct"),
    waterPct: real("water_pct"),
    boneKg: real("bone_kg"),
    visceralFat: real("visceral_fat"),
    bmrKcal: real("bmr_kcal"),
    proteinPct: real("protein_pct"),
    // 'huawei': a weigh-in imported from a Huawei Health export (weight.importHistory); never counted in streaks.
    source: text("source", { enum: ["manual", "scale", "huawei"] }).notNull().default("manual"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("weight_log_user_date_uidx").on(table.userId, table.date)],
);

/** Waist circumference (lingkar perut), cm; WIB calendar day, one row per user-day. */
export const waistLog = sqliteTable(
  "waist_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    waistCm: real("waist_cm").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("waist_log_user_date_uidx").on(table.userId, table.date)],
);

// VAR perut: foto perut milik sendiri buat diproses AI jadi verdict visual
// (turun/sama/naik) dibanding scan sebelumnya. Sifatnya privat: foto hanya
// bisa diakses lewat /var-photo/:photoId yang mengecek sesi pemiliknya, dan
// teman satu tim cuma melihat verdict+tanggal kalau pemilik memilih bagikan
// (team_member.share_var).
export const varScan = sqliteTable(
  "var_scan",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // WIB calendar day of the capture, same convention as the other logs.
    date: text("date").notNull(),
    // capability id of the private photo (var/<user_id>/<photo_id>.jpg)
    photoId: text("photo_id").notNull(),
    // 'pertama' (baseline, tanpa pembanding) | 'turun' | 'sama' | 'naik' | 'beda'
    verdict: text("verdict", { enum: ["pertama", "turun", "sama", "naik", "beda"] }).notNull(),
    // 0-1: seberapa yakin AI dengan verdictnya (visual saja, bukan pengukuran)
    confidence: real("confidence"),
    note: text("note"),
    // lingkar perut tercatat pada hari yang sama (tanda tangan objektif)
    waistCm: real("waist_cm"),
    // "Hitung ulang" yang sudah terpakai untuk scan ini (batas server-side, gratis).
    retries: integer("retries").default(0).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("var_scan_user_created_idx").on(table.userId, table.createdAt)],
);

export const foodLog = sqliteTable(
  "food_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    // 'sarapan' | 'makan_siang' | 'makan_malam' | 'snack'
    meal: text("meal").notNull(),
    name: text("name").notNull(),
    kcal: real("kcal").notNull(),
    protein: real("protein"),
    carbs: real("carbs"),
    fat: real("fat"),
    fiber: real("fiber"),
    // Portion weight in grams when known (AI scan/Cerita estimate or typed in);
    // null when unknown. Baseline for the proportional portion edit.
    grams: real("grams"),
    // 'manual' | 'ai' | 'barcode' | 'copy' (a repeat of an earlier meal, Cerita "sama kayak ...") | 'huawei' (a meal imported
    // from a Huawei Health export, food.importHistory: kept out of streaks and challenge days)
    source: text("source").notNull().default("manual"),
    // scan_id keys this item's background-removed sticker in R2
    // (scans/<id>.png); photo_id keys the original photo shared by every item
    // of one scan, stored privately at photos/<user_id>/<photo_id>.jpg
    scanId: text("scan_id"),
    photoId: text("photo_id"),
    // Cutout of the whole plate (the plate or bowl with all its food) from the same scan photo, scans/<id>.png.
    // One id per scan, the same on every component row of it; null for meals scanned before plate stickers.
    plateScanId: text("plate_scan_id"),
    // plate.id this component was paid as part of (plans.ts); null for rows
    // logged before plates existed
    plateId: text("plate_id"),
    // raw AI breakdown kept for reference
    itemsJson: text("items_json"),
    // When the food was actually eaten (unix ms), set by the "jam makan" picker; null = unknown, and time-based
    // features (sleep insights) fall back to createdAt when it plausibly fits the meal.
    eatenAt: integer("eaten_at"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("food_log_user_date_idx").on(table.userId, table.date),
    index("food_log_plate_idx").on(table.plateId),
    // Admin user detail: food logs newest first.
    index("food_log_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const exerciseLog = sqliteTable(
  "exercise_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    type: text("type"),
    name: text("name").notNull(),
    durationMin: real("duration_min"),
    kcal: real("kcal").notNull(),
    // 'manual' | 'strava' | 'health_connect' | 'apple_health' | 'joyofit' (a strength workout logged in JoyoFit;
    // external_id is `strength:<workout id>`, see exercise.upsertJoyofit)
    source: text("source").notNull().default("manual"),
    externalId: text("external_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("exercise_log_user_date_idx").on(table.userId, table.date),
    // NULL external_id (manual rows) never collides: SQLite UNIQUE treats NULLs as distinct
    uniqueIndex("exercise_log_source_external_uidx").on(
      table.userId,
      table.source,
      table.externalId,
    ),
  ],
);

export const sleepLog = sqliteTable(
  "sleep_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    hours: real("hours").notNull(),
    // 'manual' | 'health_connect' | 'apple_health' — a manual entry is user
    // intent and is never auto-overwritten by an import sync
    source: text("source").notNull().default("manual"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("sleep_log_user_date_uidx").on(table.userId, table.date)],
);

// One row per athlete grant, shared by JoyoRogo and JoyoFit: the Strava app is one app, and Strava keeps one
// refresh-token chain per athlete and app, so both products read the same tokens from here (docs/strava.md).
// A product is "linked" while its *_linked_at is set; the grant is revoked at Strava and the row deleted only
// when neither product is linked any more.
export const stravaAccount = sqliteTable(
  "strava_account",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    athleteId: text("athlete_id").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    // Space-delimited scopes the athlete granted in the latest authorization.
    scope: text("scope").notNull().default(""),
    rogoLinkedAt: integer("rogo_linked_at", { mode: "timestamp_ms" }),
    fitLinkedAt: integer("fit_linked_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  // Strava's deauthorization webhook names the athlete, not our user.
  (table) => [index("strava_account_athlete_idx").on(table.athleteId)],
);

// COROS (docs/coros.md): one OAuth grant per user at COROS's MCP server. A public client, so the tokens are all there is.
// Rows imported from COROS live in exercise_log with source 'coros'.
export const corosAccount = sqliteTable("coros_account", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  scope: text("scope").notNull().default(""),
  connectedAt: integer("connected_at", { mode: "timestamp_ms" }).notNull(),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
  // The last sync's failure, in words for a log, never shown raw; cleared by the next good sync.
  lastError: text("last_error"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

// A started COROS authorization: the PKCE verifier and where to send the browser afterwards. `state` is the
// unguessable key the redirect brings back; the row is deleted when used (or when it expires), so a code cannot be
// exchanged twice and a state belongs to the user who started it.
export const corosAuthState = sqliteTable(
  "coros_auth_state",
  {
    state: text("state").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    codeVerifier: text("code_verifier").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    // 'web' | 'native': which app the server's callback hands the code to.
    returnTo: text("return_to").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("coros_auth_state_user_idx").on(table.userId)],
);

export const profileRelations = relations(profile, ({ one }) => ({
  user: one(user, {
    fields: [profile.userId],
    references: [user.id],
  }),
}));

export const weightLogRelations = relations(weightLog, ({ one }) => ({
  user: one(user, {
    fields: [weightLog.userId],
    references: [user.id],
  }),
}));

export const foodLogRelations = relations(foodLog, ({ one }) => ({
  user: one(user, {
    fields: [foodLog.userId],
    references: [user.id],
  }),
}));

export const exerciseLogRelations = relations(exerciseLog, ({ one }) => ({
  user: one(user, {
    fields: [exerciseLog.userId],
    references: [user.id],
  }),
}));

export const sleepLogRelations = relations(sleepLog, ({ one }) => ({
  user: one(user, {
    fields: [sleepLog.userId],
    references: [user.id],
  }),
}));

export const stravaAccountRelations = relations(stravaAccount, ({ one }) => ({
  user: one(user, {
    fields: [stravaAccount.userId],
    references: [user.id],
  }),
}));

/**
 * AI cost ledger: one row per successful vision scan, anon or user.
 * Quota counts rows inside the WIB day; cost reports read latencyMs.
 * "retry" rows are free re-runs of an already-billed photo ("Hitung
 * ulang") — scansUsedToday deliberately counts only "user" rows.
 */
export const aiUsage = sqliteTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    // "failed": a scan that returned nothing usable (reason in usage_json); never billed or counted.
    // "correction": a typed/spoken fix of a scan result (ai.correctScan); free, only rate-limited.
    // "label": a nutrition-label photo read (barcode.readLabel); free, only rate-limited, failures included.
    // "coach": one coach chat message that reached the model (coach.chat); free for food scans, capped per day by COACH_DAILY_CAP.
    // "joyo": one hosted Joyo AI question that reached the model (joyo.chat); Pro, capped per day by JOYO_AI_DAILY_CAP. Counts only, never text.
    // "recap": one model run of the weekly reflection (stats.generateWeekReflection); free, capped per week by its cache row.
    // "macros": P/K/L guessed for a typed name + kcal (food.add without macros, lib/macro-estimate.ts); free, capped per day.
    scanType: text("scan_type", { enum: ["anon", "user", "retry", "failed", "correction", "label", "coach", "joyo", "recap", "dishware", "macros"] }).notNull(),
    latencyMs: integer("latency_ms").notNull(),
    usageJson: text("usage_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("ai_usage_user_created_idx").on(table.userId, table.createdAt)],
);

// Miss log: what the AI estimated vs what the user actually kept. Feeds the
// weekly TKPI calibration loop (JRG-32).
export const scanCorrection = sqliteTable(
  "scan_correction",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["web", "native"] }).notNull(),
    meal: text("meal").notNull(),
    dishName: text("dish_name").notNull(),
    aiKcal: real("ai_kcal").notNull(),
    savedKcal: real("saved_kcal").notNull(),
    aiGrams: real("ai_grams"),
    aiConfidence: real("ai_confidence"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("scan_correction_created_idx").on(table.createdAt)],
);

// Scan accuracy feedback ("Hasilnya akurat?" on the result screen): one row
// per prompt answer. `dilewati` = dismissed without a rating; accuracy
// metrics exclude it, but the row keeps the once-per-WIB-day cadence honest.
// Tapping "Hitung ulang" logs an implicit kurang_akurat row. photoId is the
// scan-src capability id of the rated photo (admin thumbnail looks it up).
export const scanFeedback = sqliteTable(
  "scan_feedback",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    photoId: text("photo_id").notNull(),
    rating: text("rating", { enum: ["akurat", "kurang_akurat", "salah", "dilewati"] }).notNull(),
    reasonsJson: text("reasons_json"),
    note: text("note"),
    afterRetry: integer("after_retry", { mode: "boolean" }).notNull().default(false),
    model: text("model"),
    source: text("source", { enum: ["web", "native"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("scan_feedback_user_created_idx").on(table.userId, table.createdAt),
    index("scan_feedback_created_idx").on(table.createdAt),
    // Admin feedback: negative results (rating in kurang_akurat/salah), newest first.
    index("scan_feedback_rating_created_idx").on(table.rating, table.createdAt),
  ],
);

/** Daily water glasses; WIB calendar day, one row per user-day. */
export const waterLog = sqliteTable(
  "water_log",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    glasses: integer("glasses").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.date] })],
);

/**
 * On-device health store daily rollup (US-013): cumulative metrics aggregated
 * by the platform store itself (Health Connect on Android, HealthKit on iOS),
 * so multiple writing apps (phone + watch) cannot double count. Workouts stay
 * in exercise_log; these numbers are displayed as-is and never added on top
 * of workout kcal in Burn.
 */
export const dailyActivity = sqliteTable(
  "daily_activity",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    steps: integer("steps").notNull().default(0),
    distanceMeters: real("distance_meters").notNull().default(0),
    activeCalories: real("active_calories").notNull().default(0),
    exerciseMinutes: real("exercise_minutes").notNull().default(0),
    // 'health_connect' | 'apple_health'
    source: text("source").notNull().default("health_connect"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("daily_activity_user_date_uidx").on(table.userId, table.date)],
);

export const dailyActivityRelations = relations(dailyActivity, ({ one }) => ({
  user: one(user, {
    fields: [dailyActivity.userId],
    references: [user.id],
  }),
}));

/** Anonymous landing-page scan budget (lifetime count per device cookie). */
export const anonScan = sqliteTable("anon_scan", {
  cookieId: text("cookie_id").primaryKey(),
  count: integer("count").notNull().default(0),
});
