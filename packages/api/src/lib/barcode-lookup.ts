/**
 * The barcode product database: lookup order, per-source miss caching and the
 * label-photo contributions that outrank every external source.
 *
 * Order: our own rows (label_photo values, never expired) -> each external
 * source in turn until one has a complete product -> not found (the client then
 * offers the label photo). Everything runs through one D1 row per code.
 */
import { and, between, desc, eq, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import type { DayZone } from "@joyorogo/i18n";
import { barcodeContribution, barcodeProduct } from "@joyorogo/db/schema/barcode";

import { classifyProduct, fetchOffProduct, SourceUnavailableError } from "./barcode";
import type { BarcodeLookup, ProductData } from "./barcode";
import { checkPer100, toPer100 } from "./barcode-nutrition";
import type {
  LabelBasis,
  LabelNutrients,
  LabelRejection,
  LabelUnit,
  Per100Values,
} from "./barcode-nutrition";
import { consensus, submissionsAgree } from "./barcode-trust";
import type { Submission } from "./barcode-trust";
import { jakartaToday } from "./engine";
import { dayBounds } from "./tiers";

/** Source id of values read from a user's label photo. */
export const LABEL_SOURCE = "label_photo";

// Products rarely change. Misses (and products without usable numbers) are
// retried sooner because anyone can add a product to a source, or photograph
// its label, at any time.
export const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MISS_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** One lookup source. `fetch` returns null for "no such product" and throws SourceUnavailableError for outages. */
export type BarcodeSource = {
  id: string;
  /**
   * An outage of a critical source fails a lookup that nobody else answered
   * (the user retries); an optional source's outage is just skipped and asked
   * again next time.
   */
  critical: boolean;
  fetch(code: string): Promise<ProductData | null>;
};

export const OFF_SOURCE: BarcodeSource = {
  id: "off",
  critical: true,
  fetch: (code) => fetchOffProduct(code),
};

type CacheRow = typeof barcodeProduct.$inferSelect;

function rowToProduct(row: CacheRow): ProductData | null {
  if (row.status !== "found" || !row.name) return null;
  return {
    name: row.name,
    brand: row.brand,
    quantity: row.quantity,
    servingSize: row.servingSize,
    unit: row.unit === "ml" ? "ml" : "g",
    kcal100: row.kcal100,
    protein100: row.protein100,
    carbs100: row.carbs100,
    fat100: row.fat100,
    fiber100: row.fiber100,
    sugar100: row.sugar100,
    imageUrl: row.imageUrl,
  };
}

function rowToLookup(code: string, row: CacheRow): BarcodeLookup {
  const product = rowToProduct(row);
  return product
    ? classifyProduct(code, product, { source: row.source, contributors: row.contributors })
    : { status: "not_found", code };
}

function productValues(product: ProductData | null) {
  return {
    status: product ? "found" : "not_found",
    name: product?.name ?? null,
    brand: product?.brand ?? null,
    quantity: product?.quantity ?? null,
    servingSize: product?.servingSize ?? null,
    unit: product?.unit ?? null,
    kcal100: product?.kcal100 ?? null,
    protein100: product?.protein100 ?? null,
    carbs100: product?.carbs100 ?? null,
    fat100: product?.fat100 ?? null,
    fiber100: product?.fiber100 ?? null,
    sugar100: product?.sugar100 ?? null,
    imageUrl: product?.imageUrl ?? null,
  };
}

async function writeRow(db: Database, code: string, values: Omit<typeof barcodeProduct.$inferInsert, "code">) {
  await db
    .insert(barcodeProduct)
    .values({ code, ...values })
    .onConflictDoUpdate({ target: barcodeProduct.code, set: values });
}

/** Misses written before sources were tracked have a null list: only Open Food Facts had said no. */
function checkedIds(row: CacheRow): Set<string> {
  return new Set((row.sourcesChecked ?? "off").split(",").filter(Boolean));
}

function isFresh(row: CacheRow, now: number): boolean {
  const age = now - row.fetchedAt.getTime();
  if (row.status === "not_found") return age < MISS_TTL_MS;
  if (row.source === LABEL_SOURCE) return true;
  const complete = rowToLookup(row.code, row).status === "found";
  return age < (complete ? FOUND_TTL_MS : MISS_TTL_MS);
}

/**
 * Looks a normalized code up. A fresh row never touches a source; a stale row
 * is served when the sources are down; outages are never cached as misses.
 * Throws SourceUnavailableError when a critical source is down and nothing else
 * (cache included) can answer.
 */
export async function lookupBarcode(
  db: Database,
  code: string,
  sources: readonly BarcodeSource[],
  now: number = Date.now(),
): Promise<BarcodeLookup> {
  const [cached] = await db.select().from(barcodeProduct).where(eq(barcodeProduct.code, code)).limit(1);
  let toAsk = sources;
  let alreadyChecked = new Set<string>();
  if (cached && isFresh(cached, now)) {
    if (cached.status === "found") return rowToLookup(code, cached);
    alreadyChecked = checkedIds(cached);
    toAsk = sources.filter((source) => !alreadyChecked.has(source.id));
    if (toAsk.length === 0) return { status: "not_found", code };
  }

  let complete: { source: BarcodeSource; product: ProductData } | null = null;
  let partial: { source: BarcodeSource; product: ProductData } | null = null;
  const answered = new Set(alreadyChecked);
  const down: BarcodeSource[] = [];
  for (const source of toAsk) {
    let product: ProductData | null;
    try {
      product = await source.fetch(code);
    } catch (error) {
      if (!(error instanceof SourceUnavailableError)) throw error;
      down.push(source);
      continue;
    }
    answered.add(source.id);
    if (!product) continue;
    const origin = { source: source.id, contributors: 0 };
    if (classifyProduct(code, product, origin).status === "found") {
      complete = { source, product };
      break;
    }
    partial ??= { source, product };
  }

  const hit = complete ?? partial;
  if (hit) {
    await writeRow(db, code, {
      ...productValues(hit.product),
      source: hit.source.id,
      contributors: 0,
      sourcesChecked: null,
      fetchedAt: new Date(now),
    });
    return classifyProduct(code, hit.product, { source: hit.source.id, contributors: 0 });
  }

  const criticalDown = down.some((source) => source.critical);
  // A stale product that no source confirms any more stays: the products rarely
  // vanish, and a miss would throw away numbers a user can still log.
  if (cached && cached.status === "found") {
    if (!criticalDown) {
      const { code: _code, ...stale } = cached;
      await writeRow(db, code, { ...stale, fetchedAt: new Date(now) });
    }
    return rowToLookup(code, cached);
  }
  if (answered.size > 0) {
    await writeRow(db, code, {
      ...productValues(null),
      source: "off",
      contributors: 0,
      sourcesChecked: [...answered].sort().join(","),
      fetchedAt: new Date(now),
    });
  }
  if (criticalDown) {
    throw new SourceUnavailableError(`${down.map((source) => source.id).join(", ")} did not answer.`);
  }
  return { status: "not_found", code };
}

// ---------------------------------------------------------------------------
// Label contributions
// ---------------------------------------------------------------------------

/** Contributions one user may save per local day: a real shopping trip, not a script. */
export const MAX_CONTRIBUTIONS_PER_DAY = 30;
/** Submissions that can compete for one code; the newest ones. */
const MAX_SUBMISSIONS_PER_CODE = 25;

export type ContributionInput = {
  name: string;
  brand: string | null;
  quantity: string | null;
  servingSize: number | null;
  unit: LabelUnit;
  basis: LabelBasis;
  nutrients: LabelNutrients;
  /** The user saw the energy warning and says the label really reads that way. */
  confirmEnergyMismatch?: boolean;
};

export type ContributionOutcome =
  /** First submission for this code, or the new numbers now stand alone. */
  | "saved"
  /** At least one other user's numbers agree: the product is now confirmed. */
  | "confirmed"
  /** Other users' agreeing numbers outweigh this submission; kept, not shown. */
  | "outvoted";

export type ContributionResult =
  | {
      ok: true;
      outcome: ContributionOutcome;
      contributors: number;
      lookup: BarcodeLookup;
    }
  | {
      ok: false;
      reason:
        | LabelRejection
        | "serving_required"
        | "already_known"
        | "name_invalid"
        | "daily_limit";
    };

const BAD_NAME = /https?:|www\.|\.(com|id|net|org|co)\b|[<>{}\p{Cc}]/iu;

/** Names are shown to every user: no links, markup or control characters. */
export function cleanText(raw: string | null, max: number): string | null {
  const text = raw?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

export function isAcceptableName(name: string | null): name is string {
  return name !== null && name.length >= 2 && !BAD_NAME.test(name);
}

/** A saved product the label flow must not overwrite: complete numbers from a lookup source. */
function lockedByExternalSource(row: CacheRow | undefined): boolean {
  if (!row || row.status !== "found" || row.source === LABEL_SOURCE) return false;
  return rowToLookup(row.code, row).status === "found";
}

async function contributionsToday(db: Database, userId: string, now: number, zone: DayZone): Promise<number> {
  const { startMs, endMs } = dayBounds(jakartaToday(new Date(now), zone), zone);
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(barcodeContribution)
    .where(
      and(
        eq(barcodeContribution.userId, userId),
        between(barcodeContribution.updatedAt, new Date(startMs), new Date(endMs)),
      ),
    );
  return row?.n ?? 0;
}

function toSubmission(row: typeof barcodeContribution.$inferSelect): Submission {
  return {
    userId: row.userId,
    name: row.name,
    brand: row.brand,
    quantity: row.quantity,
    servingSize: row.servingSize,
    unit: row.unit === "ml" ? "ml" : "g",
    kcal100: row.kcal100,
    protein100: row.protein100,
    carbs100: row.carbs100,
    fat100: row.fat100,
    fiber100: row.fiber100,
    sugar100: row.sugar100,
    at: row.updatedAt.getTime(),
  };
}

/**
 * Saves one user's reading of a label and re-derives the product row from every
 * user's latest submission. Rejections are returned, not thrown, so the router
 * owns the wording. A user can resubmit to correct themselves (their one row is
 * replaced); a second user's agreeing numbers confirm, differing ones compete.
 */
export async function recordContribution(
  db: Database,
  userId: string,
  zone: DayZone,
  code: string,
  input: ContributionInput,
  now: number = Date.now(),
): Promise<ContributionResult> {
  const name = cleanText(input.name, 120);
  if (!isAcceptableName(name)) return { ok: false, reason: "name_invalid" };
  const per100 = toPer100(input.basis, input.servingSize, input.nutrients);
  if (!per100) return { ok: false, reason: "serving_required" };
  const rejection = checkPer100(per100);
  if (rejection === "implausible" || (rejection === "energy_mismatch" && !input.confirmEnergyMismatch)) {
    return { ok: false, reason: rejection };
  }
  const [row] = await db.select().from(barcodeProduct).where(eq(barcodeProduct.code, code)).limit(1);
  if (lockedByExternalSource(row)) return { ok: false, reason: "already_known" };

  const [own] = await db
    .select({ id: barcodeContribution.id })
    .from(barcodeContribution)
    .where(and(eq(barcodeContribution.code, code), eq(barcodeContribution.userId, userId)))
    .limit(1);
  if (!own && (await contributionsToday(db, userId, now, zone)) >= MAX_CONTRIBUTIONS_PER_DAY) {
    return { ok: false, reason: "daily_limit" };
  }

  const unit = input.unit;
  const values = {
    name,
    brand: cleanText(input.brand, 80),
    quantity: cleanText(input.quantity, 60),
    servingSize: input.servingSize !== null && input.servingSize > 0 ? input.servingSize : null,
    unit,
    ...per100,
    updatedAt: new Date(now),
  };
  await db
    .insert(barcodeContribution)
    .values({ id: crypto.randomUUID(), code, userId, createdAt: new Date(now), ...values })
    .onConflictDoUpdate({ target: [barcodeContribution.code, barcodeContribution.userId], set: values });

  const rows = await db
    .select()
    .from(barcodeContribution)
    .where(eq(barcodeContribution.code, code))
    .orderBy(desc(barcodeContribution.updatedAt))
    .limit(MAX_SUBMISSIONS_PER_CODE);
  const submissions = rows.map(toSubmission);
  const decided = consensus(submissions);
  if (!decided) throw new Error("a contribution was just written, consensus cannot be empty");
  const { winner, contributors } = decided;
  await writeRow(db, code, {
    status: "found",
    source: LABEL_SOURCE,
    contributors,
    sourcesChecked: null,
    name: winner.name,
    brand: winner.brand,
    quantity: winner.quantity,
    servingSize: winner.servingSize,
    unit: winner.unit,
    kcal100: winner.kcal100,
    protein100: winner.protein100,
    carbs100: winner.carbs100,
    fat100: winner.fat100,
    fiber100: winner.fiber100,
    sugar100: winner.sugar100,
    // The pack photo belongs to whoever took it and is never kept; a source's
    // product image would not be ours to show either.
    imageUrl: null,
    fetchedAt: new Date(now),
  });
  const mine = submissions.find((s) => s.userId === userId);
  const agreesWithShown = mine !== undefined && (mine === winner || submissionsAgree(mine, winner));
  const outcome: ContributionOutcome = !agreesWithShown ? "outvoted" : contributors >= 2 ? "confirmed" : "saved";
  const [final] = await db.select().from(barcodeProduct).where(eq(barcodeProduct.code, code)).limit(1);
  return { ok: true, outcome, contributors, lookup: rowToLookup(code, final as CacheRow) };
}

/** Marks a label_photo product as the caller's own when they have a submission for it. */
export async function withOwnership(
  db: Database,
  userId: string,
  result: BarcodeLookup,
): Promise<BarcodeLookup> {
  if (result.status !== "found" || result.source !== LABEL_SOURCE) return result;
  const [own] = await db
    .select({ id: barcodeContribution.id })
    .from(barcodeContribution)
    .where(and(eq(barcodeContribution.code, result.code), eq(barcodeContribution.userId, userId)))
    .limit(1);
  return { ...result, mine: own !== undefined };
}

/** The per-100 numbers a stored label row shows, as a contribution from another user. */
export function confirmationInput(row: CacheRow): ContributionInput | null {
  if (row.status !== "found" || row.source !== LABEL_SOURCE || !row.name || row.kcal100 === null) return null;
  const values: Per100Values = {
    kcal100: row.kcal100,
    protein100: row.protein100,
    carbs100: row.carbs100,
    fat100: row.fat100,
    fiber100: row.fiber100,
    sugar100: row.sugar100,
  };
  return {
    name: row.name,
    brand: row.brand,
    quantity: row.quantity,
    servingSize: row.servingSize,
    unit: row.unit === "ml" ? "ml" : "g",
    basis: "per100",
    nutrients: {
      kcal: values.kcal100,
      protein: values.protein100,
      carbs: values.carbs100,
      fat: values.fat100,
      fiber: values.fiber100,
      sugar: values.sugar100,
    },
    // The numbers already stand in the database; confirming them is not a new claim.
    confirmEnergyMismatch: true,
  };
}
