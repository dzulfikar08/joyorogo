import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Chip } from "@/components/chip";
import { EmptyHint } from "@/components/screen-state";
import { loadRecentExerciseIds } from "@/components/workout/active-store";
import {
  type Catalog,
  type CatalogExercise,
  type ExerciseType,
  workoutApi,
  workoutQueryPrefix,
} from "@/lib/workout-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { upsertById } from "@joyorogo/api/lib/optimistic";
import { useOptimisticMutation } from "@/lib/optimistic";
import { orpc } from "@/utils/orpc";
import {
  EXERCISE_TYPES,
  type EquipmentKey,
  type MuscleKey,
} from "@joyorogo/api/lib/exercises";
import { equipmentLabel, exerciseTypeLabel, muscleLabel } from "@joyorogo/api/lib/workout";
import { Check, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

function matches(query: string, exercise: CatalogExercise): boolean {
  const q = query.trim().toLowerCase();
  return q.length === 0 || exercise.name.toLowerCase().includes(q);
}

/**
 * Exercise picker inside a sheet: search, muscle/equipment filters, recently
 * used on top, multi-select, plus custom exercise creation.
 */
export function ExercisePicker({
  open,
  onOpenChange,
  onAdd,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (exercises: CatalogExercise[]) => void;
  title?: string;
}) {
  const { t } = useTranslation(["olahraga", "common"]);
  const queryClient = useQueryClient();
  const catalog = useQuery({
    queryKey: [...workoutQueryPrefix, "catalog"],
    queryFn: () => workoutApi.catalog(),
  });
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState("all");
  const [equipment, setEquipment] = useState("all");
  const [selected, setSelected] = useState<CatalogExercise[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected([]);
      setCreating(false);
    }
  }, [open]);

  const recent = useMemo(() => loadRecentExerciseIds(), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const exercises = catalog.data?.exercises ?? [];
  const filtered = useMemo(
    () =>
      exercises.filter(
        (exercise) =>
          (muscle === "all" || exercise.muscle === muscle) &&
          (equipment === "all" || exercise.equipment === equipment) &&
          matches(query, exercise),
      ),
    [exercises, muscle, equipment, query],
  );

  const recentExercises = useMemo(
    () =>
      recent
        .map((id) => exercises.find((exercise) => exercise.id === id))
        .filter((exercise): exercise is CatalogExercise => exercise !== undefined),
    [recent, exercises],
  );

  const toggle = (exercise: CatalogExercise) => {
    setSelected((prev) =>
      prev.some((item) => item.id === exercise.id)
        ? prev.filter((item) => item.id !== exercise.id)
        : [...prev, exercise],
    );
  };

  const confirmAdd = () => {
    if (selected.length === 0) return;
    onAdd(selected);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title ?? t("latihan.action.addExercise")}>
      <div className="space-y-3">
        <label className="relative block">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("latihan.picker.search")}
            className="pl-9"
            aria-label={t("latihan.picker.searchLabel")}
          />
        </label>

        <div className="space-y-2">
          <div
            role="group"
            aria-label={t("latihan.picker.muscleGroup")}
            className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [&>*]:shrink-0"
          >
            <Chip active={muscle === "all"} onClick={() => setMuscle("all")}>
              {t("latihan.picker.allMuscles")}
            </Chip>
            {(catalog.data?.muscles ?? []).map((item) => (
              <Chip key={item.id} active={muscle === item.id} onClick={() => setMuscle(item.id)}>
                {muscleLabel(item.id as MuscleKey)}
              </Chip>
            ))}
          </div>
          <div
            role="group"
            aria-label={t("latihan.picker.equipmentGroup")}
            className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [&>*]:shrink-0"
          >
            <Chip active={equipment === "all"} onClick={() => setEquipment("all")}>
              {t("latihan.picker.allEquipment")}
            </Chip>
            {(catalog.data?.equipment ?? []).map((item) => (
              <Chip
                key={item.id}
                active={equipment === item.id}
                onClick={() => setEquipment(item.id)}
              >
                {equipmentLabel(item.id as EquipmentKey)}
              </Chip>
            ))}
          </div>
        </div>

        {creating ? (
          <CustomExerciseForm
            catalog={catalog.data}
            onCreated={(exercise) => {
              setCreating(false);
              setSelected((prev) => [...prev, exercise]);
              void queryClient.invalidateQueries({ queryKey: [...workoutQueryPrefix] });
            }}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <>
            {!catalog.isPending && recentExercises.length > 0 && (
              <PickerSection title={t("latihan.picker.recent")}>
                {recentExercises.map((exercise) => (
                  <PickerRow
                    key={`recent-${exercise.id}`}
                    exercise={exercise}
                    selected={selected.some((item) => item.id === exercise.id)}
                    sublabel={equipmentLabel(exercise.equipment as EquipmentKey)}
                    onToggle={() => toggle(exercise)}
                  />
                ))}
              </PickerSection>
            )}

            <PickerSection
              title={
                query.trim() || muscle !== "all" || equipment !== "all"
                  ? t("latihan.picker.results")
                  : t("latihan.picker.everything")
              }
            >
              {catalog.isPending ? (
                <p className="text-sm text-muted-foreground">{t("common:state.loading")}</p>
              ) : filtered.length === 0 ? (
                <EmptyHint title={t("latihan.picker.empty.title")}>{t("latihan.picker.empty.hint")}</EmptyHint>
              ) : (
                filtered.map((exercise) => (
                  <PickerRow
                    key={exercise.id}
                    exercise={exercise}
                    selected={selected.some((item) => item.id === exercise.id)}
                    sublabel={`${muscleLabel(exercise.muscle as MuscleKey)} · ${equipmentLabel(exercise.equipment as EquipmentKey)}`}
                    onToggle={() => toggle(exercise)}
                  />
                ))
              )}
            </PickerSection>

            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setCreating(true)}
              type="button"
            >
              <Plus className="size-4" aria-hidden /> {t("latihan.picker.create")}
            </Button>
          </>
        )}

        <Button className="w-full" onClick={confirmAdd} disabled={selected.length === 0}>
          {selected.length > 0
            ? t("latihan.picker.addCount", { n: selected.length })
            : t("latihan.action.addExercise")}
        </Button>
      </div>
    </Sheet>
  );
}

function PickerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 px-1 text-[0.8125rem] font-semibold text-muted-foreground">{title}</p>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
        {children}
      </ul>
    </div>
  );
}

function PickerRow({
  exercise,
  selected,
  sublabel,
  onToggle,
}: {
  exercise: CatalogExercise;
  selected: boolean;
  sublabel: string;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{exercise.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{sublabel}</span>
        </span>
        <span
          className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${
            selected ? "border-primary bg-primary text-primary-foreground" : "border-border"
          }`}
          aria-hidden
        >
          {selected && <Check className="size-4" />}
        </span>
      </button>
    </li>
  );
}

function CustomExerciseForm({
  catalog,
  onCreated,
  onCancel,
}: {
  catalog: Catalog | undefined;
  onCreated: (exercise: CatalogExercise) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [muscle, setMuscle] = useState("");
  const [equipment, setEquipment] = useState("");
  const [type, setType] = useState<ExerciseType>("weight_reps");
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation(["olahraga", "common"]);
  const queryClient = useQueryClient();

  // Optimistic catalog insert; undo removes the freshly created exercise.
  const create = useOptimisticMutation({
    mutationFn: () =>
      workoutApi.createCustomExercise({
        name: name.trim(),
        muscle: muscle || catalog?.muscles[0]?.id || "other",
        equipment: equipment || catalog?.equipment[0]?.id || "other",
        type,
      }),
    patch: (_input, cache) => {
      cache.matching<Catalog>(orpc.workout.catalog.key(), (data) => ({
        ...data,
        exercises: [
          ...data.exercises,
          {
            id: `temp-${crypto.randomUUID()}`,
            name: name.trim(),
            muscle: muscle || catalog?.muscles[0]?.id || "other",
            equipment: equipment || catalog?.equipment[0]?.id || "other",
            type,
            custom: true,
          } satisfies CatalogExercise,
        ],
      }));
    },
    invalidate: () => [orpc.workout.key()],
    success: (_input, exercise) => {
      // Swap the provisional catalog row for the real one.
      queryClient.setQueryData<Catalog>(orpc.workout.catalog.queryOptions().queryKey, (old) =>
        old
          ? {
              ...old,
              exercises: upsertById(
                old.exercises.filter((item) => !item.id.startsWith("temp-")),
                exercise,
              ),
            }
          : old,
      );
      onCreated(exercise);
      return {
        message: t("latihan.picker.toast.created", { name: exercise.name }),
        undo: () => void workoutApi.deleteCustomExercise({ id: exercise.id }),
      };
    },
    onError: (err) => setError(err.message),
  });

  const field = "w-full rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

  return (
    <div className="space-y-3 rounded-2xl border border-border p-3">
      <p className="text-sm font-bold">{t("latihan.picker.form.title")}</p>
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-muted-foreground">
          {t("latihan.picker.form.name")}
        </span>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("latihan.picker.form.namePlaceholder")}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-muted-foreground">
          {t("latihan.picker.form.muscle")}
        </span>
        <select className={field} value={muscle} onChange={(e) => setMuscle(e.target.value)}>
          {(catalog?.muscles ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {muscleLabel(item.id as MuscleKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-muted-foreground">
          {t("latihan.picker.form.equipment")}
        </span>
        <select className={field} value={equipment} onChange={(e) => setEquipment(e.target.value)}>
          {(catalog?.equipment ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {equipmentLabel(item.id as EquipmentKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-muted-foreground">
          {t("latihan.picker.form.type")}
        </span>
        <select
          className={field}
          value={type}
          onChange={(e) => setType(e.target.value as ExerciseType)}
        >
          {EXERCISE_TYPES.map((item) => (
            <option key={item} value={item}>
              {exerciseTypeLabel(item)}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          className="flex-1"
          disabled={name.trim().length === 0 || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? t("latihan.picker.form.creating") : t("latihan.picker.form.create")}
        </Button>
      </div>
      {type === "duration" && (
        <p className="text-xs text-muted-foreground">{t("latihan.picker.form.hintDuration")}</p>
      )}
    </div>
  );
}
