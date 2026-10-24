// Shared limits of the history import endpoints (weight.importHistory, food.importHistory, water.importHistory): past days
// another app's export carries, written with their own `source` and never counted in streaks or challenge days.

/** Earliest day an imported row may carry; nothing a health app exported is older than this. */
export const IMPORT_EARLIEST_DAY = "2012-01-01";

/** `food_log.source` / `weight_log.source` of rows written by an import; streak and challenge queries leave them out. */
export const IMPORT_SOURCE = "huawei";

/** `weight_log.source` values of imported weigh-ins (a Huawei export, the user's Garmin account): never a logged day. */
export const IMPORTED_WEIGHT_SOURCES: Array<"huawei" | "garmin"> = [IMPORT_SOURCE, "garmin"];
