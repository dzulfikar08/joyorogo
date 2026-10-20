// External labelled cases: photos from people outside the app who weighed what
// they ate and agreed to let us use the photos and numbers to test and improve
// the scan (internal only, deletable on request; see docs/datasets.md).
//
//   R2  dataset/external/<source>/<caseId>/photo.jpg   what the model sees
//       dataset/external/<source>/<caseId>/meta.json   ExternalMeta (below)
//
// <source> is the contributor's handle, <caseId> is "<postId>-<photo index>".
// The owner dataset (lib/dataset.ts) lives next to it under dataset/<userId>/;
// the two never mix: external meta has no `final`, so nothing that reads the
// owner dataset treats it as a diary save (the daily regression skips the
// prefix on purpose).
//
// The truth is NOT a diary save. It is the contributor's own weights, written
// by hand into a labels file (scripts/external-cases/<source>.labels.json) and
// turned into meta.json by scripts/external-import.ts. kcal is never copied
// from anyone: it is computed here from TKPI 2019 / our curated library for
// the weighed grams, and every item says which row it used and whether that row
// is a proxy for the real dish.
import { z } from "zod";

import { EXTERNAL_DATASET_PREFIX } from "./dataset";
import { plateRefSchema } from "./dishware";
import type { PlateRef } from "./dishware";
import { TKPI_DISHES } from "./tkpi";
import { TKPI_2019 } from "./tkpi2019-data";

export const EXTERNAL_META_VERSION = "external-1";

export function externalCaseKey(
  source: string,
  caseId: string,
  file: "photo.jpg" | "meta.json",
): string {
  return `${EXTERNAL_DATASET_PREFIX}${source}/${caseId}/${file}`;
}

// ------------------------------------------------------------ labels file

/** Where a per-100 g number comes from. `proxy` = the row is the closest dish, not the dish itself. */
export const refSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("tkpi2019"),
    /** Exact row name in TKPI 2019 (tkpi2019-data.ts). */
    row: z.string(),
    proxy: z.boolean().optional(),
    note: z.string().optional(),
  }),
  z.object({
    source: z.literal("library"),
    /** Exact dish name in the curated library (TKPI_DISHES in tkpi.ts). */
    dish: z.string(),
    proxy: z.boolean().optional(),
    note: z.string().optional(),
  }),
  z.object({
    source: z.literal("manual"),
    kcalPer100g: z.number().positive(),
    /** Required: say where the number comes from. Always a proxy. */
    note: z.string().min(1),
  }),
]);
export type Ref = z.infer<typeof refSchema>;

export const itemSchema = z.object({
  /** Dish name as the model would say it (Indonesian). */
  name: z.string().min(1),
  /** The contributor's own words for this item. */
  said: z.string().min(1),
  /** Weighed grams (ml counted as g for liquids). null = not weighed on its own. */
  grams: z.number().positive().nullable(),
  /** Used for kcal only when `grams` is null (a counted item such as "1 butir"); never scored as grams. */
  assumedGrams: z.number().positive().optional(),
  /** goreng | rebus | kukus | mentah | kuah | ... as eaten. */
  cooking: z.string().optional(),
  /** yes = visible in this photo; uncertain = may be; no = eaten but not in this photo. */
  inPhoto: z.enum(["yes", "uncertain", "no"]),
  /** Id of a `groups` entry when only the combined weight is known. */
  group: z.string().optional(),
  /** Omit when no honest per-100 g number exists (group members, supplements). */
  ref: refSchema.optional(),
  note: z.string().optional(),
});
export type LabelItem = z.infer<typeof itemSchema>;

/**
 * What another estimator (a chatbot the contributor asked, with the photo and his
 * grams) answered, kept for comparison only. `scope` "meal" = this case's meal,
 * "day" = the whole day the case belongs to (put it on one case of that day).
 */
export const comparatorSchema = z
  .object({
    source: z.string().min(1),
    scope: z.enum(["meal", "day"]),
    kcalLow: z.number().positive(),
    kcalHigh: z.number().positive(),
    /** What was asked and what the answer said beyond the kcal range. */
    note: z.string().optional(),
  })
  .refine((c) => c.kcalLow <= c.kcalHigh, "kcalLow is above kcalHigh");
export type Comparator = z.infer<typeof comparatorSchema>;

export const caseSchema = z.object({
  photo: z.object({
    post: z.string().min(1),
    /** 1-based position in the post's carousel. */
    index: z.number().int().positive(),
    /** File name inside the photos folder. */
    file: z.string().min(1),
  }),
  day: z.number().int().positive(),
  meal: z.string().min(1),
  /** The meal heading in the post, verbatim. */
  mealRaw: z.string().min(1),
  postedAt: z.string().optional(),
  /** His text for this meal, verbatim. */
  said: z.string().min(1),
  /** How sure the meal-to-photo mapping is. */
  mapping: z.enum(["certain", "likely", "uncertain"]),
  /**
   * How far the weights describe this photo. high = the plate in the photo is
   * what he weighed; medium = partly (some items elsewhere, or a combined
   * weight); low = the photo may not be his plate (portions are not comparable).
   */
  trust: z.enum(["high", "medium", "low"]),
  trustWhy: z.string().min(1),
  items: z.array(itemSchema).min(1),
  groups: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        grams: z.number().positive(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  /** Visible in the photo but not part of his weights (not eaten, or not counted). Never scored. */
  extras: z.array(z.object({ name: z.string().min(1), note: z.string().optional() })).default([]),
  notes: z.string().optional(),
  /** Other estimators' answers for this meal or day (Meta AI and the like). NOT ground truth: never scored, only shown next to ours. */
  comparators: z.array(comparatorSchema).default([]),
  /**
   * The plate or bowl this meal was eaten from, as the contributor measured it ("Piring saya", the
   * `plate-ref` variant of scripts/eval-scans.ts): name, kind, diameter in cm, how it looks. `inPhoto: false`
   * when that plate is not in this photo (a check that the model does not claim it).
   */
  plate: plateRefSchema.optional(),
});
export type LabelCase = z.infer<typeof caseSchema>;

export const labelsSchema = z.object({
  version: z.literal(1),
  source: z.object({
    /** Handle without "@"; the R2 folder name. */
    name: z.string().regex(/^[a-z0-9_.]+$/),
    platform: z.string().min(1),
    profile: z.string().url(),
    thread: z.string().min(1),
  }),
  consent: z.object({
    by: z.string().min(1),
    channel: z.string().min(1),
    /** Date or range the consent was given, free text (ISO dates). */
    at: z.string().min(1),
    scope: z.string().min(1),
    deletion: z.string().min(1),
  }),
  cases: z.array(caseSchema).min(1),
  /** Meals in his posts that have no photo here yet. */
  unmapped: z
    .array(
      z.object({
        day: z.number().int().positive(),
        meal: z.string(),
        said: z.string(),
        why: z.string(),
      }),
    )
    .default([]),
});
export type Labels = z.infer<typeof labelsSchema>;

export const caseIdOf = (c: LabelCase) => `${c.photo.post}-${c.photo.index}`;

// ------------------------------------------------------------- reference kcal

export type ResolvedRef = {
  source: Ref["source"];
  /** The row or dish used, or "manual". */
  name: string;
  kcalPer100g: number;
  proxy: boolean;
  note?: string;
};

const TKPI_2019_BY_NAME = new Map(TKPI_2019.map((row) => [row[1], row] as const));
const LIBRARY_BY_NAME = new Map(TKPI_DISHES.map((dish) => [dish.name, dish] as const));

/** kcal per 100 g for a ref; throws when the named row or dish does not exist. */
export function resolveRef(ref: Ref): ResolvedRef {
  if (ref.source === "tkpi2019") {
    const kcal = TKPI_2019_BY_NAME.get(ref.row)?.[3];
    if (kcal === undefined || kcal === null)
      throw new Error(`TKPI 2019 has no row "${ref.row}" with kcal`);
    return {
      source: ref.source,
      name: ref.row,
      kcalPer100g: kcal,
      proxy: ref.proxy ?? false,
      note: ref.note,
    };
  }
  if (ref.source === "library") {
    const dish = LIBRARY_BY_NAME.get(ref.dish);
    if (!dish) throw new Error(`the curated library has no dish "${ref.dish}"`);
    return {
      source: ref.source,
      name: dish.name,
      kcalPer100g: dish.kcalPer100g,
      proxy: ref.proxy ?? false,
      note: ref.note,
    };
  }
  return {
    source: ref.source,
    name: "manual",
    kcalPer100g: ref.kcalPer100g,
    proxy: true,
    note: ref.note,
  };
}

// ---------------------------------------------------------------- meta.json

export type ExternalItem = Omit<LabelItem, "ref"> & {
  ref?: ResolvedRef;
  /** Reference kcal for the weighed (or assumed) grams; absent when no honest number exists. */
  kcal?: number;
};

export type ExternalMeta = {
  version: typeof EXTERNAL_META_VERSION;
  caseId: string;
  source: {
    name: string;
    platform: string;
    profile: string;
    thread: string;
    postId: string;
    photoIndex: number;
    day: number;
    meal: string;
    mealRaw: string;
    postedAt?: string;
  };
  consent: Labels["consent"];
  said: string;
  mapping: LabelCase["mapping"];
  trust: LabelCase["trust"];
  trustWhy: string;
  photo: {
    /** sha256 of the file as scraped, before it was resized. */
    sourceSha256: string;
    prepared: string;
    bytes: number;
  };
  items: ExternalItem[];
  groups: LabelCase["groups"];
  extras: LabelCase["extras"];
  notes?: string;
  comparators: Comparator[];
  /** The plate the meal was eaten from, when the contributor measured it (see caseSchema). */
  plate?: PlateRef;
  /** What the harness scores against, over the items marked inPhoto "yes". */
  truth: {
    /** Every scored item has a reference kcal. */
    kcalComplete: boolean;
    plateKcal: number | null;
    /** Weighed grams of the scored items (combined weights counted once); null when any item has none. */
    plateGrams: number | null;
  };
  importedAt: string;
};

/** Reference kcal of one item: weighed grams, else the assumed grams; undefined when there is no ref or no grams. */
export function itemKcal(
  item: Pick<LabelItem, "grams" | "assumedGrams">,
  ref: ResolvedRef | undefined,
): number | undefined {
  const grams = item.grams ?? item.assumedGrams;
  if (!ref || grams === undefined) return undefined;
  return Math.round((ref.kcalPer100g * grams) / 100);
}

/** Truth block over the items marked inPhoto "yes" (add "uncertain" with `includeUncertain`). */
export function truthOf(
  items: readonly ExternalItem[],
  groups: LabelCase["groups"],
  includeUncertain = false,
): ExternalMeta["truth"] {
  const scored = items.filter(
    (item) => item.inPhoto === "yes" || (includeUncertain && item.inPhoto === "uncertain"),
  );
  const kcals = scored.map((item) => item.kcal);
  const kcalComplete = scored.length > 0 && kcals.every((k) => k !== undefined);
  let plateGrams: number | null = scored.length > 0 ? 0 : null;
  const usedGroups = new Set<string>();
  for (const item of scored) {
    if (plateGrams === null) break;
    if (item.group) {
      const group = groups.find((g) => g.id === item.group);
      if (!group) plateGrams = null;
      else if (!usedGroups.has(group.id)) {
        usedGroups.add(group.id);
        plateGrams += group.grams;
      }
    } else if (item.grams !== null) plateGrams += item.grams;
    else plateGrams = null;
  }
  return {
    kcalComplete,
    plateKcal: kcalComplete ? kcals.reduce<number>((sum, k) => sum + (k ?? 0), 0) : null,
    plateGrams,
  };
}

/**
 * Reference kcal of EVERYTHING he ate in the meal (every item, whether or not it is
 * in the photo), the number to put beside another estimator's answer for the whole
 * meal. Items with no reference row are listed in `missing`; `kcal` is then a floor.
 */
export function ateReference(items: readonly Pick<ExternalItem, "name" | "kcal">[]): {
  kcal: number;
  missing: string[];
} {
  return {
    kcal: items.reduce((sum, item) => sum + (item.kcal ?? 0), 0),
    missing: items.filter((item) => item.kcal === undefined).map((item) => item.name),
  };
}

/** Everything wrong with a labels file that the schema cannot say; empty = fine. */
export function labelProblems(labels: Labels): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const c of labels.cases) {
    const id = caseIdOf(c);
    if (ids.has(id)) problems.push(`${id}: listed twice`);
    ids.add(id);
    const groupIds = new Set(c.groups.map((g) => g.id));
    for (const item of c.items) {
      const where = `${id} / ${item.name}`;
      if (item.group && !groupIds.has(item.group))
        problems.push(`${where}: group "${item.group}" is not defined`);
      if (item.group && item.grams !== null)
        problems.push(`${where}: has its own grams and a group; pick one`);
      if (
        item.grams === null &&
        !item.group &&
        item.assumedGrams === undefined &&
        item.inPhoto !== "no"
      ) {
        problems.push(`${where}: no grams, no group and no assumedGrams`);
      }
      if (item.ref) {
        try {
          resolveRef(item.ref);
        } catch (error) {
          problems.push(`${where}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    for (const group of c.groups) {
      if (!c.items.some((item) => item.group === group.id))
        problems.push(`${id}: group "${group.id}" has no items`);
    }
    if (!c.items.some((item) => item.inPhoto === "yes"))
      problems.push(`${id}: no item is marked inPhoto "yes"; nothing to score`);
  }
  return problems;
}

/** meta.json for one case. `photo` describes the prepared file; throws on an unresolvable ref. */
export function buildExternalMeta(
  labels: Labels,
  c: LabelCase,
  photo: ExternalMeta["photo"],
  importedAt: string,
): ExternalMeta {
  const items: ExternalItem[] = c.items.map(({ ref, ...item }) => {
    const resolved = ref ? resolveRef(ref) : undefined;
    const kcal = itemKcal(item, resolved);
    return {
      ...item,
      ...(resolved ? { ref: resolved } : {}),
      ...(kcal !== undefined ? { kcal } : {}),
    };
  });
  return {
    version: EXTERNAL_META_VERSION,
    caseId: caseIdOf(c),
    source: {
      name: labels.source.name,
      platform: labels.source.platform,
      profile: labels.source.profile,
      thread: labels.source.thread,
      postId: c.photo.post,
      photoIndex: c.photo.index,
      day: c.day,
      meal: c.meal,
      mealRaw: c.mealRaw,
      ...(c.postedAt ? { postedAt: c.postedAt } : {}),
    },
    consent: labels.consent,
    said: c.said,
    mapping: c.mapping,
    trust: c.trust,
    trustWhy: c.trustWhy,
    photo,
    items,
    groups: c.groups,
    extras: c.extras,
    ...(c.notes ? { notes: c.notes } : {}),
    comparators: c.comparators,
    ...(c.plate ? { plate: c.plate } : {}),
    truth: truthOf(items, c.groups),
    importedAt,
  };
}
