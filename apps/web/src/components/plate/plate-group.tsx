import { Button } from "@joyorogo/ui/components/button";
import { Calendar } from "@joyorogo/ui/components/calendar";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { useQuery } from "@tanstack/react-query";
import { CalendarIcon, Pencil, Utensils } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { MEAL_EDIT_LABELS, jakartaToday, relativeDayLabel, shiftDate } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { dateKeyToUtcDate, parseIdrInput, recentDayLabel } from "@joyorogo/api/lib/format";
import type { AppRouterClient } from "@joyorogo/api/routers/index";

import { Chip } from "@/components/chip";
import { FieldLabel, ListGroup } from "@/components/kit/surface";
import { MacroLine } from "@/components/macro-line";
import { IdrInput } from "@/components/plate/idr-input";
import { MealSlotField } from "@/components/plate/meal-slot-field";
import { StickerHero } from "@/components/sticker";
import { fmtRupiah } from "@/lib/app-config";
import { fmtDateIndo, fmtInt } from "@/lib/format";
import { insertFoodRow, stripFoodRow, useOptimisticMutation } from "@/lib/optimistic";
import type { FoodListData } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

type Item = { id: string; plateId: string | null };
/** Rows the plate date-move needs to relocate between day caches. */
type FoodRowFields = {
  date: string;
  meal: string;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  scanId?: string | null;
  photoId?: string | null;
};
type PlateRow = {
  id: string;
  date: string;
  meal: string;
  name: string;
  place: string | null;
  priceIdr: number | null;
};

/** Chip shortcuts for the three most recent days, WIB. */
export function DayChips({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const today = jakartaToday();
  const options = [today, shiftDate(today, -1), shiftDate(today, -2)];
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((date) => (
        <Chip key={date} active={value === date} onClick={() => onChange(date)}>
          {relativeDayLabel(date, today)}
        </Chip>
      ))}
    </div>
  );
}

/** Styled calendar sheet: future days and anything older than the window are off. */
export function CalendarSheet({
  value,
  onPick,
  onClose,
}: {
  value: string;
  onPick: (date: string) => void;
  onClose: () => void;
}) {
  const today = jakartaToday();
  // Manual key parse: `new Date("2026-10-14")` is unreliable off-browser.
  const selected = dateKeyToUtcDate(value) ?? new Date();
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Pilih tanggal"
      description={`Antara ${fmtDateIndo(shiftDate(today, -30))} dan hari ini.`}
    >
      <Calendar
        mode="single"
        selected={selected}
        defaultMonth={selected}
        onSelect={(day) => {
          if (!day) return;
          onPick(jakartaToday(day));
          onClose();
        }}
        timeZone="UTC"
        disabled={[
          { after: dateKeyToUtcDate(today) ?? new Date() },
          { before: dateKeyToUtcDate(shiftDate(today, -30)) ?? new Date() },
        ]}
      />
    </Sheet>
  );
}

/**
 * Diary plate grouping: rows sharing a plate render under one "Piring" header
 * that shows the plate's price, with an inline edit for name/place/price.
 * Rows without a plate (old data) render exactly as before, ungrouped.
 * `renderRow` keeps this file free of diary-specific row markup.
 */
export function PlateDiary<T extends Item & FoodRowFields>({
  items,
  date,
  renderRow,
  plateAction,
}: {
  items: T[];
  date: string;
  renderRow: (item: T) => ReactNode;
  /** Secondary actions (Favorit) shown inside the plate edit sheet. */
  plateAction?: (plate: PlateRow, rows: T[]) => ReactNode;
}) {
  const plates = useQuery(orpc.plate.byDate.queryOptions({ input: { date } }));
  const byId = new Map((plates.data ?? []).map((plate) => [plate.id, plate]));
  const [editing, setEditing] = useState<string | null>(null);

  const groups: Array<{ plateId: string | null; items: T[] }> = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.plateId !== null && last.plateId === item.plateId) {
      last.items.push(item);
    } else {
      groups.push({ plateId: item.plateId, items: [item] });
    }
  }

  return (
    <div className="space-y-2">
      {groups.map((group, index) => {
        const plate = group.plateId ? byId.get(group.plateId) : undefined;
        const totalKcal = group.items.reduce((sum, row) => sum + row.kcal, 0);
        const totalProtein = group.items.reduce((sum, row) => sum + (row.protein ?? 0), 0);
        const totalCarbs = group.items.reduce((sum, row) => sum + (row.carbs ?? 0), 0);
        const totalFat = group.items.reduce((sum, row) => sum + (row.fat ?? 0), 0);
        const totalFiber = group.items.reduce((sum, row) => sum + (row.fiber ?? 0), 0);
        return (
          <div key={group.plateId ?? `solo-${group.items[0]?.id ?? index}`}>
            {plate && (
              <div className="rounded-t-3xl bg-muted px-5 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Utensils className="size-4 shrink-0 text-makan-ink" aria-hidden />
                  <span className="inline-flex min-w-0 flex-1 items-center gap-x-1.5 truncate font-semibold">
                    <span className="truncate">Piring: {plate.name}</span>
                    {plate.place && (
                      <>
                        <span
                          className="size-1 shrink-0 rounded-full bg-muted-foreground/60"
                          aria-hidden
                        />
                        <span className="truncate font-normal text-muted-foreground">
                          {plate.place}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="shrink-0 font-bold tabular-nums">
                    {plate.priceIdr != null ? fmtRupiah(plate.priceIdr) : "Tanpa harga"}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Ubah harga ${plate.name}`}
                    onClick={() => setEditing(plate.id)}
                    className="text-muted-foreground"
                  >
                    <Pencil />
                  </Button>
                </div>
                <p className="flex flex-wrap items-center gap-x-3 text-xs font-semibold text-muted-foreground">
                  <span className="tabular-nums">{fmtInt(totalKcal)} kcal</span>
                  <MacroLine
                    protein={totalProtein}
                    carbs={totalCarbs}
                    fat={totalFat}
                    fiber={totalFiber}
                  />
                </p>
              </div>
            )}
            <ListGroup className={plate ? "rounded-t-none border-t-0" : undefined}>
              {group.items.map(renderRow)}
            </ListGroup>
          </div>
        );
      })}
      {editing &&
        groups.map((group) => {
          const plate = group.plateId === editing ? byId.get(group.plateId!) : undefined;
          return plate && group.plateId ? (
            <PlateEditSheet
              key={group.plateId}
              plate={plate}
              rows={group.items}
              onClose={() => setEditing(null)}
              action={plateAction?.(plate, group.items)}
            />
          ) : null;
        })}
    </div>
  );
}

function PlateEditSheet({
  plate,
  rows,
  onClose,
  action,
}: {
  plate: PlateRow;
  rows: Array<Item & FoodRowFields>;
  onClose: () => void;
  action?: ReactNode;
}) {
  const [name, setName] = useState(plate.name);
  const [place, setPlace] = useState(plate.place ?? "");
  const [price, setPrice] = useState(plate.priceIdr != null ? String(plate.priceIdr) : "");
  const [date, setDate] = useState(plate.date);
  const [meal, setMeal] = useState<Meal>(plate.meal as Meal);
  const [pickingDate, setPickingDate] = useState(false);
  const dateChanged = date !== plate.date;
  const mealChanged = meal !== plate.meal;

  const listOptions = (day: string) => orpc.food.listByDate.queryOptions({ input: { date: day } });
  const plateOptions = (day: string) => orpc.plate.byDate.queryOptions({ input: { date: day } });

  // Field edits patch every byDate cache; a date change additionally relocates
  // the plate row and every component row between the two day caches (with
  // matching summary deltas). Undo re-runs the same mutation with the old values.
  const update = useOptimisticMutation<Parameters<AppRouterClient["plate"]["update"]>[0], unknown>({
    mutationFn: (input) => client.plate.update(input),
    patch: (input, cache) => {
      const fields = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.place !== undefined ? { place: input.place } : {}),
        ...(input.priceIdr !== undefined ? { priceIdr: input.priceIdr } : {}),
        ...(input.meal !== undefined ? { meal: input.meal } : {}),
      };
      const to = input.date ?? plate.date;
      const toMeal = input.meal ?? plate.meal;
      if (to === plate.date) {
        cache.matching<PlateRow[]>(orpc.plate.byDate.key(), (data) =>
          data.map((row) => (row.id === plate.id ? { ...row, ...fields } : row)),
        );
        if (toMeal !== plate.meal) {
          cache.value<FoodListData<Item & FoodRowFields>>(listOptions(plate.date).queryKey, (data) =>
            data
              ? {
                  ...data,
                  items: data.items.map((item) =>
                    item.plateId === plate.id ? { ...item, meal: toMeal } : item,
                  ),
                }
              : data,
          );
          for (const row of rows) {
            cache.summary({
              date: plate.date,
              kcal: -row.kcal,
              protein: -(row.protein ?? 0),
              carbs: -(row.carbs ?? 0),
              fat: -(row.fat ?? 0),
              meal: row.meal,
              meals: -1,
            });
            cache.summary({
              date: plate.date,
              kcal: row.kcal,
              protein: row.protein ?? 0,
              carbs: row.carbs ?? 0,
              fat: row.fat ?? 0,
              meal: toMeal,
              meals: 1,
            });
          }
        }
        return;
      }
      const movedPlate = { ...plate, ...fields, date: to };
      cache.value<PlateRow[]>(plateOptions(plate.date).queryKey, (data) =>
        (data ?? []).filter((row) => row.id !== plate.id),
      );
      cache.value<PlateRow[]>(plateOptions(to).queryKey, (data) => [...(data ?? []), movedPlate]);
      for (const row of rows) {
        const movedRow = { ...row, date: to, meal: toMeal };
        stripFoodRow(cache, listOptions(plate.date).queryKey, row);
        insertFoodRow(cache, listOptions(to).queryKey, movedRow);
        cache.summary({
          date: plate.date,
          kcal: -row.kcal,
          protein: -(row.protein ?? 0),
          carbs: -(row.carbs ?? 0),
          fat: -(row.fat ?? 0),
          meal: row.meal,
          meals: -1,
        });
        cache.summary({
          date: to,
          kcal: row.kcal,
          protein: row.protein ?? 0,
          carbs: row.carbs ?? 0,
          fat: row.fat ?? 0,
          meal: toMeal,
          meals: 1,
        });
      }
    },
    invalidate: () => [orpc.plate.key(), orpc.food.key(), orpc.day.key()],
    success: (input) => {
      onClose();
      const restore = {
        id: plate.id,
        name: plate.name,
        place: plate.place,
        priceIdr: plate.priceIdr,
        meal: plate.meal as Meal,
      };
      if (input.date && input.date !== plate.date) {
        return {
          message: `Dipindah ke ${relativeDayLabel(input.date, jakartaToday())}`,
          undo: () => void client.plate.update({ ...restore, date: plate.date }),
        };
      }
      if (input.meal && input.meal !== plate.meal) {
        return {
          message: `Dipindah ke ${MEAL_EDIT_LABELS[input.meal]}`,
          undo: () => void client.plate.update(restore),
        };
      }
      return {
        message: "Piring diperbarui",
        undo: () => void client.plate.update(restore),
      };
    },
  });

  const submit = () => {
    const priceNum = parseIdrInput(price);
    if (price.trim() !== "" && priceNum === null) {
      toast.error("Harga belum valid.");
      return;
    }
    update.mutate({
      id: plate.id,
      name: name.trim() || plate.name,
      place: place.trim() === "" ? null : place.trim(),
      priceIdr: priceNum === null ? null : Math.round(priceNum),
      ...(dateChanged ? { date } : {}),
      ...(mealChanged ? { meal } : {}),
    });
  };

  return (
    <>
      <Sheet open onOpenChange={(open) => !open && onClose()} title="Ubah piring">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <StickerHero
            scanId={rows.find((row) => row.scanId)?.scanId}
            photoId={rows.find((row) => row.scanId)?.photoId}
            name={plate.name}
          />
          <div>
            <FieldLabel htmlFor="plate-name">Nama piring</FieldLabel>
            <Input
              id="plate-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nasi padang"
            />
          </div>
          <div>
            <FieldLabel htmlFor="plate-place">Tempat (opsional)</FieldLabel>
            <Input
              id="plate-place"
              value={place}
              onChange={(event) => setPlace(event.target.value)}
              placeholder="RM Sederhana"
            />
          </div>
          <div>
            <FieldLabel htmlFor="plate-price">Harga sepiring (Rp)</FieldLabel>
            <IdrInput
              id="plate-price"
              value={price}
              onChange={setPrice}
              placeholder="mis. 28.000"
            />
          </div>
          <div>
            <FieldLabel htmlFor="plate-date">Dicatat pada</FieldLabel>
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
              <p className="text-xs text-muted-foreground">
                {dateChanged
                  ? `Akan dipindah ke ${fmtDateIndo(date)} beserta ${rows.length} catatannya.`
                  : "Pindahkan piring ini ke hari lain bila salah hari."}
              </p>
            </div>
          </div>
          <MealSlotField
            id="plate-meal"
            value={meal}
            current={plate.meal as Meal}
            onChange={setMeal}
            hint={
              mealChanged
                ? `Piring dan ${rows.length} catatannya dipindah ke ${MEAL_EDIT_LABELS[meal]}.`
                : "Pindahkan piring ini bila salah waktu makan."
            }
          />
          <Button type="submit" className="w-full" disabled={update.isPending}>
            {update.isPending ? "Menyimpan..." : dateChanged || mealChanged ? "Pindahkan" : "Simpan"}
          </Button>
          {action}
        </form>
      </Sheet>
      {pickingDate && (
        <CalendarSheet value={date} onPick={setDate} onClose={() => setPickingDate(false)} />
      )}
    </>
  );
}
