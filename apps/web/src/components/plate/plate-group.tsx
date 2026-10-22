import { fmtClock, getActiveDayZone } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { Calendar } from "@joyorogo/ui/components/calendar";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { useQuery } from "@tanstack/react-query";
import { CalendarIcon, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { MEAL_EDIT_LABELS, jakartaToday, relativeDayLabel, shiftDate } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { dateKeyToUtcDate, parseIdrInput } from "@joyorogo/api/lib/format";
import type { AppRouterClient } from "@joyorogo/api/routers/index";

import { Chip } from "@/components/chip";
import { FieldLabel, ListGroup } from "@/components/kit/surface";
import { MacroLine } from "@/components/macro-line";
import { IdrInput } from "@/components/plate/idr-input";
import { MealSlotField } from "@/components/plate/meal-slot-field";
import { RecalcPlateAction } from "@/components/plate/recalc-plate";
import { FoodThumb, StickerHero, useStickerTarget } from "@/components/sticker";
import { fmtRupiah } from "@/lib/app-config";
import { fmtDateLong, fmtInt } from "@/lib/format";
import { insertFoodRow, stripFoodRow, useOptimisticMutation } from "@/lib/optimistic";
import type { FoodListData } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

type Item = { id: string; plateId: string | null };
/** Rows the plate date-move needs to relocate between day caches. */
type FoodRowFields = {
  name: string;
  date: string;
  meal: string;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  scanId: string | null;
  plateScanId?: string | null;
  photoId?: string | null;
  createdAt?: Date | string;
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
  const { t } = useTranslation(["makan", "common"]);
  const today = jakartaToday();
  // Manual key parse: `new Date("2026-10-14")` is unreliable off-browser.
  const selected = dateKeyToUtcDate(value) ?? new Date();
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("plate.calendar.title")}
      description={t("plate.calendar.range", { from: fmtDateLong(shiftDate(today, -30)) })}
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
 * Diary plate grouping: rows sharing a plate render as one group. The plate header is a row of its own
 * (thumbnail, name, time, place and price, total kcal, edit) and its components sit inset beneath it,
 * quieter, behind a left rule. Rows without a plate (old data, single items) render as ordinary rows.
 * Groups sit flush inside the meal slot card. `renderRow` keeps this file free of diary-specific row markup;
 * it learns whether the row is a plate component (`nested`) so it can draw the compact variant.
 */
export function PlateDiary<T extends Item & FoodRowFields>({
  items,
  date,
  renderRow,
  plateAction,
}: {
  items: T[];
  date: string;
  renderRow: (item: T, context: { nested: boolean }) => ReactNode;
  /** Secondary actions (Favorit) shown inside the plate edit sheet. */
  plateAction?: (plate: PlateRow, rows: T[]) => ReactNode;
}) {
  const { t } = useTranslation(["makan", "common"]);
  const stickerTarget = useStickerTarget();
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
    <div className="divide-y divide-border">
      {groups.map((group, index) => {
        const plate = group.plateId ? byId.get(group.plateId) : undefined;
        const key = group.plateId ?? `solo-${group.items[0]?.id ?? index}`;
        // A plate of one component stays a normal row; the group treatment is for 2 or more.
        if (!plate || group.items.length < 2) {
          return (
            <ListGroup key={key} className="rounded-none bg-transparent">
              {group.items.map((item) => renderRow(item, { nested: false }))}
            </ListGroup>
          );
        }
        const totalKcal = group.items.reduce((sum, row) => sum + row.kcal, 0);
        const totalProtein = group.items.reduce((sum, row) => sum + (row.protein ?? 0), 0);
        const totalCarbs = group.items.reduce((sum, row) => sum + (row.carbs ?? 0), 0);
        const totalFat = group.items.reduce((sum, row) => sum + (row.fat ?? 0), 0);
        const totalFiber = group.items.reduce((sum, row) => sum + (row.fiber ?? 0), 0);
        const photo = group.items.find((row) => row.scanId || row.plateScanId || row.photoId);
        const firstAt = group.items
          .map((row) => (row.createdAt ? new Date(row.createdAt) : null))
          .filter((at): at is Date => at !== null && !Number.isNaN(at.getTime()))
          .sort((a, b) => a.getTime() - b.getTime())[0];
        const meta = [
          firstAt ? fmtClock(firstAt, undefined, getActiveDayZone()) : null,
          plate.place,
          plate.priceIdr != null ? fmtRupiah(plate.priceIdr) : t("plate.header.noPrice"),
        ].filter(Boolean);
        return (
          <div key={key} className="pb-3">
            <div className="flex items-center gap-3 px-4 pt-3 pb-2">
              <FoodThumb
                scanId={photo?.scanId}
                photoId={photo?.photoId}
                name={plate.name}
                kcal={totalKcal}
                protein={totalProtein}
                carbs={totalCarbs}
                fat={totalFat}
                {...(photo ? stickerTarget(photo, group.items, plate.name) : {})}
                viewThumb
                className="size-12"
                iconClassName="size-5"
              />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="line-clamp-2 text-[0.9375rem] leading-snug font-bold break-words">
                  {t("plate.header.title", { name: plate.name })}
                </p>
                <p className="truncate text-xs text-muted-foreground tabular-nums">
                  {meta.join(" · ")}
                </p>
                <MacroLine
                  compact
                  className="text-[0.8125rem] text-muted-foreground"
                  protein={totalProtein}
                  carbs={totalCarbs}
                  fat={totalFat}
                  fiber={totalFiber}
                />
              </div>
              <span className="shrink-0 text-right">
                <span className="block text-lg leading-none font-extrabold text-kcal tabular-nums">
                  {fmtInt(totalKcal)}
                </span>
                <span className="mt-0.5 block text-[0.6875rem] font-semibold text-muted-foreground">
                  {t("diary.summary.unit")}
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("plate.header.editPrice", { name: plate.name })}
                onClick={() => setEditing(plate.id)}
                className="shrink-0 text-muted-foreground"
              >
                <Pencil />
              </Button>
            </div>
            <ul className="mr-4 ml-10 divide-y divide-border/60 border-l-2 border-border bg-muted/40">
              {group.items.map((item) => renderRow(item, { nested: true }))}
            </ul>
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
  const { t } = useTranslation(["makan", "common"]);
  const stickerTarget = useStickerTarget();
  const anchor = rows.find((row) => row.scanId || row.plateScanId);
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
          message: t("plate.toast.movedDay", { date: relativeDayLabel(input.date, jakartaToday()) }),
          undo: () => void client.plate.update({ ...restore, date: plate.date }),
        };
      }
      if (input.meal && input.meal !== plate.meal) {
        return {
          message: t("plate.toast.movedSlot", { meal: MEAL_EDIT_LABELS[input.meal] }),
          undo: () => void client.plate.update(restore),
        };
      }
      return {
        message: t("plate.toast.updated"),
        undo: () => void client.plate.update(restore),
      };
    },
  });

  const submit = () => {
    const priceNum = parseIdrInput(price);
    if (price.trim() !== "" && priceNum === null) {
      toast.error(t("plate.edit.invalidPrice"));
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
      <Sheet open onOpenChange={(open) => !open && onClose()} title={t("plate.edit.title")}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <StickerHero
            scanId={anchor?.scanId}
            photoId={anchor?.photoId}
            name={plate.name}
            {...(anchor ? stickerTarget(anchor, rows, plate.name) : {})}
          />
          <div>
            <FieldLabel htmlFor="plate-name">{t("plate.edit.name")}</FieldLabel>
            <Input
              id="plate-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("plate.edit.namePlaceholder")}
            />
          </div>
          <div>
            <FieldLabel htmlFor="plate-place">{t("plate.edit.place")}</FieldLabel>
            <Input
              id="plate-place"
              value={place}
              onChange={(event) => setPlace(event.target.value)}
              placeholder={t("plate.edit.placePlaceholder")}
            />
          </div>
          <div>
            <FieldLabel htmlFor="plate-price">{t("plate.edit.price")}</FieldLabel>
            <IdrInput
              id="plate-price"
              value={price}
              onChange={setPrice}
              placeholder={t("plate.edit.pricePlaceholder", { example: fmtInt(28000) })}
            />
          </div>
          <div>
            <FieldLabel htmlFor="plate-date">{t("plate.edit.loggedOn")}</FieldLabel>
            <div className="mt-1.5 space-y-2">
              <DayChips value={date} onChange={setDate} />
              <Button
                type="button"
                variant={dateChanged ? "secondary" : "outline"}
                size="sm"
                aria-expanded={pickingDate}
                aria-label={t("plate.edit.pickDate", {
                  date: relativeDayLabel(date, jakartaToday()),
                })}
                onClick={() => setPickingDate(true)}
              >
                <CalendarIcon aria-hidden />
                {relativeDayLabel(date, jakartaToday())}
              </Button>
              <p className="text-xs text-muted-foreground">
                {dateChanged
                  ? t("plate.edit.movedHint", { date: fmtDateLong(date), count: rows.length })
                  : t("plate.edit.dateHint")}
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
                ? t("plate.edit.slotMovedHint", {
                    meal: MEAL_EDIT_LABELS[meal],
                    count: rows.length,
                  })
                : t("plate.edit.slotHint")
            }
          />
          <Button type="submit" className="w-full" disabled={update.isPending}>
            {update.isPending
              ? t("plate.edit.saving")
              : dateChanged || mealChanged
                ? t("plate.edit.move")
                : t("common:actions.save")}
          </Button>
          <RecalcPlateAction plateId={plate.id} />
          {action}
        </form>
      </Sheet>
      {pickingDate && (
        <CalendarSheet value={date} onPick={setDate} onClose={() => setPickingDate(false)} />
      )}
    </>
  );
}
