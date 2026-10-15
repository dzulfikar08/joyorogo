import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarIcon, Link2, Link2Off } from "lucide-react";
import { useState } from "react";

import { jakartaToday, relativeDayLabel } from "@joyorogo/api/lib/engine";
import { recentDayLabel } from "@joyorogo/api/lib/format";
import { PORTION_MULTIPLIERS, scalePortion } from "@joyorogo/api/lib/portion";
import type { PortionValues } from "@joyorogo/api/lib/portion";

import { Chip } from "@/components/chip";
import { FieldLabel } from "@/components/kit/surface";
import { MacroLine } from "@/components/macro-line";
import { CalendarSheet, DayChips } from "@/components/plate/plate-group";
import { SheetActions } from "@/components/sheet-actions";
import type { FoodItem } from "@/lib/api-types";
import { fmtDateIndo, fmtInt, parseNum } from "@/lib/format";
import { OptimisticCache, insertFoodRow, stripFoodRow, useOptimisticMutation } from "@/lib/optimistic";
import type { FoodListData } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

type FoodUpdateInput = Parameters<typeof client.food.update>[0];

const listKey = (date: string) => orpc.food.listByDate.queryOptions({ input: { date } }).queryKey;

/** Decimal-comma text for an input, at most `digits` decimals, no trailing zeros. */
const fmtField = (n: number, digits = 0) =>
  String(Math.round(n * 10 ** digits) / 10 ** digits).replace(".", ",");

/** The stored portion fields of a row, as the shared portion math wants them. */
const portionOf = (row: FoodItem): PortionValues => ({
  grams: row.grams,
  kcal: row.kcal,
  protein: row.protein,
  carbs: row.carbs,
  fat: row.fat,
  fiber: row.fiber,
});

/** Payload that sets a row to exactly these values (the undo path reuses it). */
function updateInput(row: FoodItem, values: PortionValues, extra: Partial<FoodUpdateInput>) {
  return {
    id: row.id,
    kcal: values.kcal,
    ...(values.grams !== null ? { grams: values.grams } : {}),
    ...(values.protein !== null ? { protein: values.protein } : {}),
    ...(values.carbs !== null ? { carbs: values.carbs } : {}),
    ...(values.fat !== null ? { fat: values.fat } : {}),
    ...(values.fiber !== null ? { fiber: values.fiber } : {}),
    ...extra,
  } satisfies FoodUpdateInput;
}

/**
 * Cache patch for one edited row: same-day edits replace the row in place and
 * move the day totals by the delta; a date change relocates it between the two
 * day caches. Day summaries get the matching deltas.
 */
function patchFoodEdit(cache: OptimisticCache, before: FoodItem, after: FoodItem) {
  const delta = {
    kcal: after.kcal - before.kcal,
    protein: (after.protein ?? 0) - (before.protein ?? 0),
    carbs: (after.carbs ?? 0) - (before.carbs ?? 0),
    fat: (after.fat ?? 0) - (before.fat ?? 0),
  };
  if (after.date !== before.date) {
    stripFoodRow(cache, listKey(before.date), before);
    insertFoodRow(cache, listKey(after.date), after);
    cache.summary({
      date: before.date,
      kcal: -before.kcal,
      protein: -(before.protein ?? 0),
      carbs: -(before.carbs ?? 0),
      fat: -(before.fat ?? 0),
      meal: before.meal,
      meals: -1,
    });
    cache.summary({
      date: after.date,
      kcal: after.kcal,
      protein: after.protein ?? 0,
      carbs: after.carbs ?? 0,
      fat: after.fat ?? 0,
      meal: after.meal,
      meals: 1,
    });
    return;
  }
  cache.value<FoodListData<FoodItem>>(listKey(before.date), (old) =>
    old
      ? {
          items: old.items.map((item) => (item.id === before.id ? after : item)),
          totals: {
            kcal: Math.max(0, old.totals.kcal + delta.kcal),
            protein: Math.max(0, old.totals.protein + delta.protein),
            carbs: Math.max(0, old.totals.carbs + delta.carbs),
            fat: Math.max(0, old.totals.fat + delta.fat),
            fiber: Math.max(0, old.totals.fiber + (after.fiber ?? 0) - (before.fiber ?? 0)),
          },
        }
      : old,
  );
  cache.summary({ date: before.date, ...delta, meal: before.meal });
}

/**
 * Edit sheet for one logged food: name, portion and day.
 *
 * Portion math is linear from the stored row. Rows with a weight get a gram
 * and a kcal field that follow each other (link button to break the tie);
 * rows without one get 0,5x / 1x / 1,5x / 2x chips plus a custom multiplier.
 * Typing kcal always rescales the macros. The macro preview shows exactly what
 * will be stored; price lives on the plate and does not change with portion.
 */
export function FoodPortionSheet({
  row,
  onClose,
  favorite,
  onFavorite,
  onShare,
  onDelete,
}: {
  row: FoodItem;
  onClose: () => void;
  favorite: boolean;
  onFavorite: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const base = portionOf(row);
  const hasGrams = base.grams !== null;
  const [name, setName] = useState(row.name);
  const [date, setDate] = useState(row.date);
  const [pickingDate, setPickingDate] = useState(false);
  const [linked, setLinked] = useState(true);
  // Scale of the portion relative to what was logged; macros always follow it.
  const [ratio, setRatio] = useState(1);
  const [gramsText, setGramsText] = useState(hasGrams ? fmtField(base.grams!) : "");
  const [kcalText, setKcalText] = useState(fmtField(base.kcal));
  const [multText, setMultText] = useState("1");

  const typedKcal = parseNum(kcalText);
  const typedGrams = parseNum(gramsText);
  const scaled = scalePortion(base, ratio);
  const values: PortionValues = {
    ...scaled,
    kcal: typedKcal === null ? scaled.kcal : Math.round(typedKcal),
    grams: hasGrams && typedGrams !== null ? Math.round(typedGrams) : scaled.grams,
  };
  const valid =
    name.trim() !== "" &&
    typedKcal !== null &&
    typedKcal >= 0 &&
    typedKcal <= 5000 &&
    (!hasGrams || (typedGrams !== null && typedGrams >= 1 && typedGrams <= 5000));
  const dateChanged = date !== row.date;
  const changed =
    dateChanged ||
    name.trim() !== row.name ||
    values.kcal !== row.kcal ||
    values.grams !== row.grams ||
    ratio !== 1;

  /** Re-render every field from a new scale (the linked path). */
  const applyRatio = (next: number) => {
    const s = scalePortion(base, next);
    setRatio(next);
    setKcalText(fmtField(s.kcal));
    setMultText(fmtField(next, 2));
    if (hasGrams) setGramsText(fmtField(s.grams!));
  };

  const onGrams = (text: string) => {
    setGramsText(text);
    const grams = parseNum(text);
    if (linked && hasGrams && grams !== null && grams > 0) {
      const next = grams / base.grams!;
      const s = scalePortion(base, next);
      setRatio(next);
      setKcalText(fmtField(s.kcal));
    }
  };

  const onKcal = (text: string) => {
    setKcalText(text);
    const kcal = parseNum(text);
    if (kcal === null || kcal < 0 || base.kcal <= 0) return;
    const next = kcal / base.kcal;
    setRatio(next);
    setMultText(fmtField(next, 2));
    if (linked && hasGrams) setGramsText(fmtField(scalePortion(base, next).grams!));
  };

  const onMult = (text: string) => {
    setMultText(text);
    const mult = parseNum(text);
    if (mult !== null && mult > 0) applyRatio(mult);
  };

  const toggleLink = () => {
    // Re-linking lets energy lead: weight snaps back in line with the kcal.
    if (!linked && typedKcal !== null && base.kcal > 0) applyRatio(typedKcal / base.kcal);
    setLinked(!linked);
  };

  const update = useOptimisticMutation<FoodUpdateInput, FoodItem | null>({
    mutationFn: (input) => client.food.update(input),
    patch: (input, cache) => {
      patchFoodEdit(cache, row, {
        ...row,
        ...values,
        name: input.name ?? row.name,
        date: input.date ?? row.date,
      });
    },
    invalidate: () => [orpc.food.key(), orpc.plate.key(), orpc.day.key()],
    success: (input) => {
      const moved = input.date && input.date !== row.date;
      return {
        message: moved
          ? `Dipindah ke ${relativeDayLabel(input.date!, jakartaToday())}`
          : `${input.name ?? row.name} diperbarui`,
        undo: () => {
          const cache = new OptimisticCache(queryClient);
          patchFoodEdit(
            cache,
            { ...row, ...values, name: input.name ?? row.name, date: input.date ?? row.date },
            row,
          );
          void client.food
            .update(updateInput(row, base, { name: row.name, ...(moved ? { date: row.date } : {}) }))
            .finally(() => {
              for (const key of [orpc.food.key(), orpc.plate.key(), orpc.day.key()]) {
                void queryClient.invalidateQueries({ queryKey: key });
              }
            });
        },
      };
    },
  });

  const submit = () => {
    if (!valid || !changed) return;
    update.mutate(
      updateInput(row, values, {
        ...(name.trim() !== row.name ? { name: name.trim() } : {}),
        ...(dateChanged ? { date } : {}),
      }),
    );
    onClose();
  };

  return (
    <>
      <Sheet open onOpenChange={(open) => !open && onClose()} title="Ubah porsi">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div>
            <FieldLabel htmlFor="food-name">Nama</FieldLabel>
            <Input id="food-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>

          {hasGrams ? (
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <FieldLabel htmlFor="food-grams">Berat (g)</FieldLabel>
                <Input
                  id="food-grams"
                  inputMode="decimal"
                  value={gramsText}
                  onChange={(event) => onGrams(event.target.value)}
                  aria-invalid={typedGrams === null || typedGrams < 1 ? true : undefined}
                />
              </div>
              <Button
                type="button"
                variant={linked ? "secondary" : "outline"}
                size="icon"
                aria-pressed={linked}
                aria-label={
                  linked
                    ? "Berat dan kalori terhubung, ketuk untuk melepas"
                    : "Berat dan kalori terlepas, ketuk untuk menghubungkan"
                }
                title={linked ? "Terhubung" : "Terlepas"}
                onClick={toggleLink}
                className="mb-0.5"
              >
                {linked ? <Link2 aria-hidden /> : <Link2Off aria-hidden />}
              </Button>
              <div className="min-w-0 flex-1">
                <FieldLabel htmlFor="food-kcal">Kalori (kcal)</FieldLabel>
                <Input
                  id="food-kcal"
                  inputMode="decimal"
                  value={kcalText}
                  onChange={(event) => onKcal(event.target.value)}
                  aria-invalid={typedKcal === null ? true : undefined}
                />
              </div>
            </div>
          ) : (
            <>
              <div>
                <FieldLabel htmlFor="food-mult">Porsi</FieldLabel>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {PORTION_MULTIPLIERS.map((mult) => (
                    <Chip key={mult} active={ratio === mult} onClick={() => applyRatio(mult)}>
                      {fmtField(mult, 1)}x
                    </Chip>
                  ))}
                  <Input
                    id="food-mult"
                    inputMode="decimal"
                    value={multText}
                    onChange={(event) => onMult(event.target.value)}
                    aria-label="Kelipatan porsi sendiri"
                    className="w-24"
                  />
                </div>
              </div>
              <div>
                <FieldLabel htmlFor="food-kcal">Kalori (kcal)</FieldLabel>
                <Input
                  id="food-kcal"
                  inputMode="decimal"
                  value={kcalText}
                  onChange={(event) => onKcal(event.target.value)}
                  aria-invalid={typedKcal === null ? true : undefined}
                />
              </div>
            </>
          )}

          <div className="rounded-2xl bg-muted px-4 py-3 text-sm" aria-live="polite">
            <p className="font-semibold tabular-nums">
              {fmtInt(values.kcal)} kcal
              {hasGrams && values.grams !== null ? ` · ${fmtInt(values.grams)} g` : ""}
            </p>
            <MacroLine
              className="mt-1 text-muted-foreground"
              protein={values.protein}
              carbs={values.carbs}
              fat={values.fat}
              fiber={values.fiber}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {hasGrams && !linked
                ? "Terlepas: berat dan kalori diisi sendiri, makro ikut kalori."
                : "Makro ikut berubah sesuai porsi. Harga piring tidak ikut berubah."}
            </p>
          </div>

          <div>
            <FieldLabel htmlFor="food-date">Dicatat pada</FieldLabel>
            <div className="mt-1.5 space-y-2">
              <DayChips value={date} onChange={setDate} />
              <Button
                type="button"
                variant={dateChanged ? "secondary" : "outline"}
                size="sm"
                aria-expanded={pickingDate}
                aria-label={`Pilih tanggal, terpilih ${recentDayLabel(date, jakartaToday())}`}
                onClick={() => setPickingDate(true)}
              >
                <CalendarIcon aria-hidden />
                {recentDayLabel(date, jakartaToday())}
              </Button>
              {dateChanged && (
                <p className="text-xs text-muted-foreground">
                  Akan dipindah ke {fmtDateIndo(date)}.
                </p>
              )}
            </div>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={update.isPending || !valid || !changed}
          >
            {update.isPending ? "Menyimpan..." : "Simpan"}
          </Button>

          <SheetActions
            favorite={favorite}
            onFavorite={onFavorite}
            onShare={onShare}
            onDelete={onDelete}
          />
        </form>
      </Sheet>
      {pickingDate && (
        <CalendarSheet value={date} onPick={setDate} onClose={() => setPickingDate(false)} />
      )}
    </>
  );
}
