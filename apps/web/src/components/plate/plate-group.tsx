import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Utensils } from "lucide-react";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import type { AppRouterClient } from "@joyorogo/api/routers/index";

import { FieldLabel, ListGroup } from "@/components/kit/surface";
import { fmtRupiah } from "@/lib/app-config";
import { parseNum } from "@/lib/format";
import { useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

type Item = { id: string; plateId: string | null };

/**
 * Diary plate grouping: rows sharing a plate render under one "Piring" header
 * that shows the plate's price, with an inline edit for name/place/price.
 * Rows without a plate (old data) render exactly as before, ungrouped.
 * `renderRow` keeps this file free of diary-specific row markup.
 */
export function PlateDiary<T extends Item>({
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
      {editing && <PlateEditSheet id={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PlateEditSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const plates = useQuery(orpc.plate.byDate.queryOptions({ input: {} }));
  const plate = (plates.data ?? []).find((row) => row.id === id);
  const [name, setName] = useState(plate?.name ?? "");
  const [place, setPlace] = useState(plate?.place ?? "");
  const [price, setPrice] = useState(plate?.priceIdr != null ? String(plate.priceIdr) : "");

  // Optimistic name/place/price patch in every byDate cache; undo re-applies
  // the previous values captured at patch time.
  const previous = useRef<{ name: string; place: string | null; priceIdr: number | null } | null>(
    null,
  );
  const update = useOptimisticMutation<
    Parameters<AppRouterClient["plate"]["update"]>[0],
    unknown
  >({
    mutationFn: (input) => client.plate.update(input),
    patch: (input, cache) => {
      previous.current = plate
        ? { name: plate.name, place: plate.place, priceIdr: plate.priceIdr }
        : null;
      cache.matching<Array<{ id: string; name: string; place: string | null; priceIdr: number | null }>>(
        orpc.plate.byDate.key(),
        (data) =>
          data.map((row) =>
            row.id === input.id
              ? {
                  ...row,
                  ...(input.name !== undefined ? { name: input.name } : {}),
                  ...(input.place !== undefined ? { place: input.place } : {}),
                  ...(input.priceIdr !== undefined ? { priceIdr: input.priceIdr } : {}),
                }
              : row,
          ),
      );
    },
    invalidate: () => [orpc.plate.key()],
    success: () => {
      onClose();
      const prev = previous.current;
      previous.current = null;
      if (!prev) return { message: "Piring diperbarui" };
      return {
        message: "Piring diperbarui",
        undo: () =>
          void client.plate.update({
            id,
            name: prev.name,
            place: prev.place,
            priceIdr: prev.priceIdr,
          }),
      };
    },
  });

  if (!plate) return null;
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()} title="Ubah piring">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const priceNum = price.trim() === "" ? null : parseNum(price);
          if (price.trim() !== "" && (priceNum === null || priceNum < 0)) {
            toast.error("Harga belum valid.");
            return;
          }
          update.mutate({
            id,
            name: name.trim() || plate.name,
            place: place.trim() === "" ? null : place.trim(),
            priceIdr: priceNum === null ? null : Math.round(priceNum),
          });
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
        <Button type="submit" className="w-full" disabled={update.isPending}>
          {update.isPending ? "Menyimpan..." : "Simpan"}
        </Button>
      </form>
    </Sheet>
  );
}
