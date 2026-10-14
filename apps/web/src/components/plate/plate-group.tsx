import { Button } from "@joyorogo/ui/components/button";
import { Calendar } from "@joyorogo/ui/components/calendar";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Utensils } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { jakartaToday, relativeDayLabel, shiftDate } from "@joyorogo/api/lib/engine";
import type { AppRouterClient } from "@joyorogo/api/routers/index";

import { Chip } from "@/components/chip";
import { FieldLabel, ListGroup } from "@/components/kit/surface";
import { fmtRupiah } from "@/lib/app-config";
import { fmtDateIndo, parseNum } from "@/lib/format";
import { insertFoodRow, stripFoodRow, useOptimisticMutation } from "@/lib/optimistic";
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
function DayChips({ value, onChange }: { value: string; onChange: (date: string) => void }) {
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
function CalendarSheet({
  value,
  onPick,
  onClose,
}: {
  value: string;
  onPick: (date: string) => void;
  onClose: () => void;
}) {
  const today = jakartaToday();
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
        selected={new Date(`${value}T00:00:00Z`)}
        defaultMonth={new Date(`${value}T00:00:00Z`)}
        onSelect={(day) => {
          if (!day) return;
          onPick(day.toISOString().slice(0, 10));
          onClose();
        }}
        timeZone="UTC"
        disabled={[{ after: new Date(`${today}T23:59:59Z`) }, { before: new Date(`${shiftDate(today, -30)}T00:00:00Z`) }]}
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
}: {
  items: T[];
  date: string;
  renderRow: (item: T) => ReactNode;
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
        return (
          <div key={group.plateId ?? `solo-${group.items[0]?.id ?? index}`}>
            {plate && (
              <div className="flex items-center gap-2 rounded-t-3xl bg-muted px-5 py-2 text-sm">
                <Utensils className="size-4 shrink-0 text-makan-ink" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  Piring: {plate.name}
                  {plate.place ? ` · ${plate.place}` : ""}
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
}: {
  plate: PlateRow;
  rows: Array<Item & FoodRowFields>;
  onClose: () => void;
}) {
  const [name, setName] = useState(plate.name);
  const [place, setPlace] = useState(plate.place ?? "");
  const [price, setPrice] = useState(plate.priceIdr != null ? String(plate.priceIdr) : "");
  const [date, setDate] = useState(plate.date);
  const [pickingDate, setPickingDate] = useState(false);
  const dateChanged = date !== plate.date;

  const listOptions = (day: string) => orpc.food.listByDate.queryOptions({ input: { date: day } });
  const plateOptions = (day: string) => orpc.plate.byDate.queryOptions({ input: { date: day } });

  // Field edits patch every byDate cache; a date change additionally relocates
  // the plate row and every component row between the two day caches (with
  // matching summary deltas). Undo re-runs the same mutation with the old values.
  const update = useOptimisticMutation<
    Parameters<AppRouterClient["plate"]["update"]>[0],
    unknown
  >({
    mutationFn: (input) => client.plate.update(input),
    patch: (input, cache) => {
      const fields = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.place !== undefined ? { place: input.place } : {}),
        ...(input.priceIdr !== undefined ? { priceIdr: input.priceIdr } : {}),
      };
      const to = input.date;
      if (!to || to === plate.date) {
        cache.matching<PlateRow[]>(orpc.plate.byDate.key(), (data) =>
          data.map((row) => (row.id === plate.id ? { ...row, ...fields } : row)),
        );
        return;
      }
      const movedPlate = { ...plate, ...fields, date: to };
      cache.value<PlateRow[]>(plateOptions(plate.date).queryKey, (data) =>
        (data ?? []).filter((row) => row.id !== plate.id),
      );
      cache.value<PlateRow[]>(plateOptions(to).queryKey, (data) => [...(data ?? []), movedPlate]);
      for (const row of rows) {
        const movedRow = { ...row, date: to };
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
          meal: row.meal,
          meals: 1,
        });
      }
    },
    invalidate: () => [orpc.plate.key(), orpc.food.key(), orpc.day.key()],
    success: (input) => {
      onClose();
      if (input.date && input.date !== plate.date) {
        return {
          message: `Dipindah ke ${relativeDayLabel(input.date, jakartaToday())}`,
          undo: () =>
            void client.plate.update({
              id: plate.id,
              name: plate.name,
              place: plate.place,
              priceIdr: plate.priceIdr,
              date: plate.date,
            }),
        };
      }
      return {
        message: "Piring diperbarui",
        undo: () =>
          void client.plate.update({
            id: plate.id,
            name: plate.name,
            place: plate.place,
            priceIdr: plate.priceIdr,
          }),
      };
    },
  });

  const submit = () => {
    const priceNum = price.trim() === "" ? null : parseNum(price);
    if (price.trim() !== "" && (priceNum === null || priceNum < 0)) {
      toast.error("Harga belum valid.");
      return;
    }
    update.mutate({
      id: plate.id,
      name: name.trim() || plate.name,
      place: place.trim() === "" ? null : place.trim(),
      priceIdr: priceNum === null ? null : Math.round(priceNum),
      ...(dateChanged ? { date } : {}),
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
            <Input
              id="plate-price"
              type="number"
              min="0"
              inputMode="numeric"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="28000"
            />
          </div>
          <div>
            <FieldLabel htmlFor="plate-date">Dicatat pada</FieldLabel>
            <div className="mt-1.5 space-y-2">
              <DayChips value={date} onChange={setDate} />
              <button
                type="button"
                onClick={() => setPickingDate(true)}
                className="min-h-11 px-1 text-sm font-semibold text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                Pilih tanggal
              </button>
              <p className="text-xs text-muted-foreground">
                {dateChanged
                  ? `Akan dipindah ke ${fmtDateIndo(date)} beserta ${rows.length} catatannya.`
                  : "Pindahkan piring ini ke hari lain bila salah hari."}
              </p>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={update.isPending}>
            {update.isPending
              ? "Menyimpan..."
              : dateChanged
                ? "Pindahkan"
                : "Simpan"}
          </Button>
        </form>
      </Sheet>
      {pickingDate && (
        <CalendarSheet value={date} onPick={setDate} onClose={() => setPickingDate(false)} />
      )}
    </>
  );
}
