// Which cutout stands for a meal on a share card or in the full-size viewer.
//
// A scanned meal carries one cutout per food component (scan_id) and one of the
// whole plate (plate_scan_id, the same on every row of the scan). The plate
// sticker is the hero: it already shows every component, so the component
// cutouts are not drawn next to it (the same food would appear twice). They stay
// in the diary rows, the food sheet and the Foto grid, and they are the
// fallback for meals scanned before plate stickers existed.

export type StickerRowLike = {
  name: string;
  kcal: number;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  scanId: string | null;
  plateScanId?: string | null;
  photoId?: string | null;
};

export type MealStickerTarget = {
  /** The cutout shown and shared: the plate sticker when the scan has one, else the first component's. */
  scanId: string;
  /** Component cutout to show instead when the plate sticker cannot be loaded (still being cut, or failed). */
  fallbackScanId: string | null;
  /** True when `scanId` is the whole-plate sticker. */
  plate: boolean;
  /** One food: its own name. Several: `joinNames(first, others)`, e.g. "Nasi +2". */
  name: string;
  /** Summed over the rows the sticker stands for. */
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  photoId: string | null;
};

function sum(rows: readonly StickerRowLike[], pick: (row: StickerRowLike) => number | null | undefined): number | null {
  let total: number | null = null;
  for (const row of rows) {
    const value = pick(row);
    if (value !== null && value !== undefined) total = (total ?? 0) + value;
  }
  return total;
}

/**
 * What tapping `anchor` should open and share. With a plate sticker it is the
 * plate: every row of the same scan in `rows` (so name and kcal are the
 * plate's, matching the picture), `plateName` standing in for the joined names
 * when the user named the plate. Without one it is the row's own cutout and
 * numbers, exactly as before plate stickers. Null when there is nothing to show.
 */
export function mealStickerTarget(
  anchor: StickerRowLike,
  rows: readonly StickerRowLike[],
  joinNames: (first: string, others: number) => string,
  plateName?: string | null,
): MealStickerTarget | null {
  const plateScanId = anchor.plateScanId ?? null;
  if (!plateScanId) {
    if (!anchor.scanId) return null;
    return {
      scanId: anchor.scanId,
      fallbackScanId: null,
      plate: false,
      name: anchor.name,
      kcal: anchor.kcal,
      protein: anchor.protein ?? null,
      carbs: anchor.carbs ?? null,
      fat: anchor.fat ?? null,
      photoId: anchor.photoId ?? null,
    };
  }
  const scan = rows.filter((row) => row.plateScanId === plateScanId);
  const members = scan.length > 0 ? scan : [anchor];
  const first = members[0]!;
  return {
    scanId: plateScanId,
    fallbackScanId: members.find((row) => row.scanId)?.scanId ?? null,
    plate: true,
    name: plateName?.trim() || (members.length > 1 ? joinNames(first.name, members.length - 1) : first.name),
    kcal: members.reduce((total, row) => total + row.kcal, 0),
    protein: sum(members, (row) => row.protein),
    carbs: sum(members, (row) => row.carbs),
    fat: sum(members, (row) => row.fat),
    photoId: members.find((row) => row.photoId)?.photoId ?? null,
  };
}
