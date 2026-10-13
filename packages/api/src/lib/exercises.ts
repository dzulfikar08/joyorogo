// Code catalog of strength-training movements. Stable string ids are stored
// in workout_set.exercise_id; the list is additive-only so old rows keep
// resolving. Muscle mapping follows the roadmap's fixed list — primary
// muscles earn a full effective set, secondary ones half.

export const MUSCLES = [
  { key: "dada", label: "Dada" },
  { key: "punggung_atas", label: "Punggung atas" },
  { key: "lats", label: "Lats" },
  { key: "bahu_depan", label: "Bahu depan" },
  { key: "bahu_samping", label: "Bahu samping" },
  { key: "bahu_belakang", label: "Bahu belakang" },
  { key: "biceps", label: "Biceps" },
  { key: "triceps", label: "Triceps" },
  { key: "lengan_bawah", label: "Lengan bawah" },
  { key: "perut", label: "Perut" },
  { key: "glutes", label: "Glutes" },
  { key: "quadriceps", label: "Quadriceps" },
  { key: "hamstring", label: "Hamstring" },
  { key: "betis", label: "Betis" },
] as const;

export type MuscleKey = (typeof MUSCLES)[number]["key"];

export const MUSCLE_LABELS: Record<MuscleKey, string> = Object.fromEntries(
  MUSCLES.map((m) => [m.key, m.label]),
) as Record<MuscleKey, string>;

export const EQUIPMENT = [
  { key: "barbell", label: "Barbell" },
  { key: "dumbbell", label: "Dumbbell" },
  { key: "mesin", label: "Mesin" },
  { key: "kabel", label: "Kabel" },
  { key: "bodyweight", label: "Tanpa alat" },
] as const;

export type EquipmentKey = (typeof EQUIPMENT)[number]["key"];

export type Exercise = {
  id: string;
  name: string;
  equipment: EquipmentKey;
  primary: MuscleKey[];
  secondary: MuscleKey[];
};

function ex(
  id: string,
  name: string,
  equipment: EquipmentKey,
  primary: MuscleKey[],
  secondary: MuscleKey[] = [],
): Exercise {
  return { id, name, equipment, primary, secondary };
}

export const EXERCISE_CATALOG: Exercise[] = [
  // Barbell
  ex("bench_press", "Bench press", "barbell", ["dada"], ["bahu_depan", "triceps"]),
  ex("incline_bench_press", "Incline bench press", "barbell", ["dada"], ["bahu_depan", "triceps"]),
  ex(
    "close_grip_bench_press",
    "Close-grip bench press",
    "barbell",
    ["triceps"],
    ["dada", "bahu_depan"],
  ),
  ex("overhead_press", "Overhead press", "barbell", ["bahu_depan"], ["bahu_samping", "triceps"]),
  ex(
    "barbell_row",
    "Barbell row",
    "barbell",
    ["lats", "punggung_atas"],
    ["biceps", "bahu_belakang"],
  ),
  ex(
    "deadlift",
    "Deadlift",
    "barbell",
    ["punggung_atas", "glutes"],
    ["hamstring", "quadriceps", "lengan_bawah"],
  ),
  ex(
    "romanian_deadlift",
    "Romanian deadlift",
    "barbell",
    ["hamstring", "glutes"],
    ["punggung_atas"],
  ),
  ex("squat", "Squat", "barbell", ["quadriceps", "glutes"], ["hamstring", "betis"]),
  ex("front_squat", "Front squat", "barbell", ["quadriceps"], ["glutes", "perut"]),
  ex("barbell_lunge", "Lunge barbell", "barbell", ["quadriceps", "glutes"], ["hamstring"]),
  ex("hip_thrust", "Hip thrust", "barbell", ["glutes"], ["hamstring", "perut"]),
  ex("barbell_curl", "Barbell curl", "barbell", ["biceps"], ["lengan_bawah"]),

  // Dumbbell
  ex(
    "dumbbell_bench_press",
    "Dumbbell bench press",
    "dumbbell",
    ["dada"],
    ["bahu_depan", "triceps"],
  ),
  ex(
    "incline_dumbbell_press",
    "Incline dumbbell press",
    "dumbbell",
    ["dada"],
    ["bahu_depan", "triceps"],
  ),
  ex(
    "dumbbell_shoulder_press",
    "Dumbbell shoulder press",
    "dumbbell",
    ["bahu_depan"],
    ["bahu_samping", "triceps"],
  ),
  ex("lateral_raise", "Lateral raise", "dumbbell", ["bahu_samping"]),
  ex("front_raise", "Front raise", "dumbbell", ["bahu_depan"]),
  ex("rear_delt_fly", "Rear delt fly", "dumbbell", ["bahu_belakang"], ["punggung_atas"]),
  ex(
    "dumbbell_row",
    "Dumbbell row",
    "dumbbell",
    ["lats", "punggung_atas"],
    ["biceps", "bahu_belakang"],
  ),
  ex("dumbbell_fly", "Dumbbell fly", "dumbbell", ["dada"], ["bahu_depan"]),
  ex("dumbbell_curl", "Dumbbell curl", "dumbbell", ["biceps"], ["lengan_bawah"]),
  ex("hammer_curl", "Hammer curl", "dumbbell", ["biceps", "lengan_bawah"]),
  ex("wrist_curl", "Wrist curl", "dumbbell", ["lengan_bawah"]),
  ex("goblet_squat", "Goblet squat", "dumbbell", ["quadriceps", "glutes"], ["perut"]),
  ex(
    "bulgarian_split_squat",
    "Bulgarian split squat",
    "dumbbell",
    ["quadriceps", "glutes"],
    ["hamstring"],
  ),
  ex("dumbbell_lunge", "Lunge dumbbell", "dumbbell", ["quadriceps", "glutes"], ["hamstring"]),
  ex("dumbbell_step_up", "Step-up", "dumbbell", ["quadriceps", "glutes"], ["hamstring", "betis"]),
  ex("triceps_kickback", "Triceps kickback", "dumbbell", ["triceps"]),

  // Mesin
  ex("leg_press", "Leg press", "mesin", ["quadriceps", "glutes"], ["hamstring"]),
  ex("leg_extension", "Leg extension", "mesin", ["quadriceps"]),
  ex("leg_curl", "Leg curl", "mesin", ["hamstring"], ["glutes"]),
  ex("lat_pulldown", "Lat pulldown", "mesin", ["lats"], ["biceps", "punggung_atas"]),
  ex("machine_chest_press", "Chest press (mesin)", "mesin", ["dada"], ["bahu_depan", "triceps"]),
  ex("pec_deck", "Pec deck", "mesin", ["dada"], ["bahu_depan"]),
  ex(
    "machine_shoulder_press",
    "Shoulder press (mesin)",
    "mesin",
    ["bahu_depan"],
    ["bahu_samping", "triceps"],
  ),
  ex(
    "machine_row",
    "Seated row (mesin)",
    "mesin",
    ["punggung_atas", "lats"],
    ["biceps", "bahu_belakang"],
  ),
  ex("back_extension", "Back extension", "mesin", ["punggung_atas"], ["glutes", "hamstring"]),
  ex("standing_calf_raise", "Standing calf raise", "mesin", ["betis"]),
  ex("seated_calf_raise", "Seated calf raise", "mesin", ["betis"]),

  // Kabel
  ex("triceps_pushdown", "Triceps pushdown", "kabel", ["triceps"]),
  ex("overhead_triceps_extension", "Overhead triceps extension", "kabel", ["triceps"]),
  ex("cable_fly", "Cable fly", "kabel", ["dada"], ["bahu_depan"]),
  ex("face_pull", "Face pull", "kabel", ["bahu_belakang"], ["punggung_atas"]),
  ex("cable_curl", "Cable curl", "kabel", ["biceps"]),
  ex(
    "cable_row",
    "Seated cable row",
    "kabel",
    ["punggung_atas", "lats"],
    ["biceps", "bahu_belakang"],
  ),

  // Tanpa alat
  ex("push_up", "Push-up", "bodyweight", ["dada"], ["triceps", "bahu_depan"]),
  ex("diamond_push_up", "Diamond push-up", "bodyweight", ["triceps"], ["dada", "bahu_depan"]),
  ex("pike_push_up", "Pike push-up", "bodyweight", ["bahu_depan"], ["bahu_samping", "triceps"]),
  ex("pull_up", "Pull-up", "bodyweight", ["lats"], ["biceps", "punggung_atas"]),
  ex("chin_up", "Chin-up", "bodyweight", ["lats", "biceps"], ["punggung_atas"]),
  ex("dips", "Dips", "bodyweight", ["dada", "triceps"], ["bahu_depan"]),
  ex("inverted_row", "Inverted row", "bodyweight", ["punggung_atas", "lats"], ["biceps"]),
  ex("bodyweight_squat", "Squat tanpa beban", "bodyweight", ["quadriceps"], ["glutes"]),
  ex("wall_sit", "Wall sit", "bodyweight", ["quadriceps"]),
  ex("glute_bridge", "Glute bridge", "bodyweight", ["glutes"], ["hamstring", "perut"]),
  ex("plank", "Plank", "bodyweight", ["perut"]),
  ex("side_plank", "Side plank", "bodyweight", ["perut"], ["glutes"]),
  ex("crunch", "Crunch", "bodyweight", ["perut"]),
  ex("leg_raise", "Leg raise", "bodyweight", ["perut"]),
  ex("hanging_knee_raise", "Hanging knee raise", "bodyweight", ["perut"]),
  ex("russian_twist", "Russian twist", "bodyweight", ["perut"]),
  ex("superman", "Superman", "bodyweight", ["punggung_atas"], ["glutes"]),
  ex("dead_hang", "Dead hang", "bodyweight", ["lengan_bawah"], ["lats"]),
  ex("farmer_carry", "Farmer carry", "bodyweight", ["lengan_bawah", "punggung_atas"], ["perut"]),
];

const BY_ID: Record<string, Exercise> = Object.fromEntries(EXERCISE_CATALOG.map((e) => [e.id, e]));

export function exerciseById(id: string): Exercise | undefined {
  return BY_ID[id];
}

/** Catalog movements training this muscle, primary movers first. */
export function exercisesForMuscle(muscle: MuscleKey): Exercise[] {
  const primary = EXERCISE_CATALOG.filter((e) => e.primary.includes(muscle));
  const secondary = EXERCISE_CATALOG.filter(
    (e) => !e.primary.includes(muscle) && e.secondary.includes(muscle),
  );
  return [...primary, ...secondary];
}
