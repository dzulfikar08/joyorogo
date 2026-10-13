import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Chip } from "@/components/chip";
import { EmptyHint } from "@/components/screen-state";
import type { CatalogExercise } from "@/lib/api-types";
import { orpc } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

const EQUIPMENT_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "barbell", label: "Barbell" },
  { value: "dumbbell", label: "Dumbbell" },
  { value: "mesin", label: "Mesin" },
  { value: "kabel", label: "Kabel" },
  { value: "bodyweight", label: "Tanpa alat" },
];

function matches(query: string, exercise: CatalogExercise): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return exercise.name.toLowerCase().includes(q) || exercise.id.includes(q);
}

/** Searchable movement catalog inside a sheet; picking adds it to the session. */
export function ExercisePicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (exercise: CatalogExercise) => void;
}) {
  const catalog = useQuery(orpc.workout.catalog.queryOptions());
  const [query, setQuery] = useState("");
  const [equipment, setEquipment] = useState("all");

  const filtered = useMemo(
    () =>
      (catalog.data?.exercises ?? []).filter(
        (exercise) =>
          (equipment === "all" || exercise.equipment === equipment) &&
          matches(query, exercise),
      ),
    [catalog.data, equipment, query],
  );

  const muscleLabel = (key: string) =>
    catalog.data?.muscles.find((m) => m.key === key)?.label ?? key;
  const equipmentLabel = (key: string) =>
    EQUIPMENT_FILTERS.find((f) => f.value === key)?.label ?? key;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Tambah gerakan">
      <div className="space-y-3">
        <label className="flex items-center gap-2 rounded-2xl bg-muted px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari gerakan, mis. bench"
            aria-label="Cari gerakan"
            className="border-0 bg-transparent px-0 focus-visible:ring-0"
          />
        </label>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {EQUIPMENT_FILTERS.map((filter) => (
            <Chip
              key={filter.value}
              active={equipment === filter.value}
              onClick={() => setEquipment(filter.value)}
            >
              {filter.label}
            </Chip>
          ))}
        </div>

        {catalog.isPending ? (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">Memuat katalog…</p>
        ) : filtered.length === 0 ? (
          <EmptyHint title="Tidak ketemu">
            Coba kata kunci lain atau ganti filter alat.
          </EmptyHint>
        ) : (
          <ul className="max-h-[55dvh] divide-y divide-border overflow-y-auto">
            {filtered.map((exercise) => (
              <li key={exercise.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(exercise);
                    onOpenChange(false);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-1 py-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{exercise.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {exercise.primary.map(muscleLabel).join(", ")}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                    {equipmentLabel(exercise.equipment)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
