// Card scale on separate pieces (egg, tempe, tahu, ayam goreng piece, bakwan...): with the card's pixels per cm
// (lib/card-plate.ts) the box the scan wrote for an item gives its footprint in cm, and footprint x piece height x
// density gives grams. Rebuilt from the 2026-10-20 geometry record (docs/ai-accuracy-log.md): an isolated flat piece was
// measured well there, anything hidden or touching other items was not, so a computed weight only replaces the
// model's when the item is alone in the photo, is one piece, and lands within 0.6-2x of the model's own grams.
import { itemAtGrams } from "./item-grams";
import { isBoiledEgg, PIECE_WEIGHTS } from "./piece-count";
import type { ItemBox } from "./vision";
import type { CalibratedItem } from "./tkpi";

/** Footprint share of the box a piece fills (a round or rounded piece in its bounding box). */
const FILL = 0.75;
/** A piece's mean height is this share of its short side, within MIN_HEIGHT_CM..MAX_HEIGHT_CM. */
const HEIGHT_PER_SHORT_SIDE = 0.4;
const MIN_HEIGHT_CM = 1;
const MAX_HEIGHT_CM = 4;
const MIN_SIDE_CM = 1;
const MAX_SIDE_CM = 34;
/** Other items' boxes may cover at most this share of the item's own box. */
export const MAX_OVERLAP = 0.2;
/** The computed weight is only used within this window around the model's. */
export const GEOMETRY_WINDOW: readonly [number, number] = [0.6, 2];

/** Items whose name is a separate piece: the counted-piece table plus the fried pieces it does not list. */
const EXTRA_PIECES = /\b(tempe|tahu|ayam goreng|ayam crispy|paha ayam|dada ayam|sayap ayam)\b/;
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
export const isPieceItem = (name: string) => {
  const key = normalize(name);
  return PIECE_WEIGHTS.some((row) => row.name.test(key)) || EXTRA_PIECES.test(key);
};

/** Grams per cm3, rounded household values (egg, tofu and tempeh are dense, a fritter is airy). */
const DENSITIES: ReadonlyArray<readonly [RegExp, number]> = [
  [/\btelur\b/, 0.95],
  [/\b(tempe|tahu)\b/, 0.95],
  [/\b(bakwan|pastel|onde onde|pisang goreng)\b/, 0.6],
  [/\b(ayam|nugget|bakso|sate)\b/, 0.9],
];
const densityOf = (name: string) => {
  const key = normalize(name);
  return DENSITIES.find(([re]) => re.test(key))?.[1] ?? 0.8;
};

export type PieceScale = { pxPerCm: number; width: number; height: number };
type PieceItem = CalibratedItem & { box?: ItemBox; kind?: string };

export type PieceReading = {
  name: string;
  modelG?: number;
  geoG?: number;
  lenCm?: number;
  widCm?: number;
  /** The computed grams replaced the model's. */
  applied: boolean;
  skip?: "no_box" | "not_piece" | "counted" | "overlap" | "footprint" | "no_grams" | "window";
};

/** Share of `box` that other boxes cover (summed, capped at 1); loose rectangles over-count, which only makes the rule stricter. */
function covered(box: ItemBox, others: ItemBox[]): number {
  const area = (box[2] - box[0]) * (box[3] - box[1]);
  const shared = others.reduce((sum, o) => {
    const h = Math.min(box[2], o[2]) - Math.max(box[0], o[0]);
    const w = Math.min(box[3], o[3]) - Math.max(box[1], o[1]);
    return sum + (h > 0 && w > 0 ? h * w : 0);
  }, 0);
  return Math.min(1, shared / area);
}

/** What the card scale says about each item, and the items with the computed grams where the rule lets it replace the model's. */
export function applyPieceGeometry<T extends PieceItem>(items: readonly T[], scale: PieceScale): { items: T[]; readings: PieceReading[] } {
  const readings: PieceReading[] = [];
  const out = items.map((item, index): T => {
    const reading: PieceReading = { name: item.name, ...(item.grams !== undefined ? { modelG: item.grams } : {}), applied: false };
    readings.push(reading);
    const skip = (reason: NonNullable<PieceReading["skip"]>): T => {
      reading.skip = reason;
      return item;
    };
    if (!isPieceItem(item.name)) return skip("not_piece");
    if (!item.box) return skip("no_box");
    if (item.pieces && item.pieces.count > 1) return skip("counted");
    if (item.grams === undefined || !(item.grams > 0)) return skip("no_grams");
    const others = items.flatMap((o, i) => (i !== index && o.box ? [o.box] : []));
    if (covered(item.box, others) > MAX_OVERLAP) return skip("overlap");
    const [ymin, xmin, ymax, xmax] = item.box;
    const lenCm = (Math.max((xmax - xmin) * scale.width, (ymax - ymin) * scale.height) / 1000) / scale.pxPerCm;
    const widCm = (Math.min((xmax - xmin) * scale.width, (ymax - ymin) * scale.height) / 1000) / scale.pxPerCm;
    reading.lenCm = Math.round(lenCm * 10) / 10;
    reading.widCm = Math.round(widCm * 10) / 10;
    if (widCm < MIN_SIDE_CM || lenCm > MAX_SIDE_CM) return skip("footprint");
    // A whole boiled egg is an ellipsoid as deep as it is wide; any other piece is a footprint times a mean height.
    const volumeCm3 = isBoiledEgg(item.name)
      ? (Math.PI / 6) * lenCm * widCm * widCm
      : lenCm * widCm * FILL * Math.min(MAX_HEIGHT_CM, Math.max(MIN_HEIGHT_CM, HEIGHT_PER_SHORT_SIDE * widCm));
    const geoG = Math.round(volumeCm3 * densityOf(item.name));
    reading.geoG = geoG;
    if (geoG < item.grams * GEOMETRY_WINDOW[0] || geoG > item.grams * GEOMETRY_WINDOW[1]) return skip("window");
    const at = itemAtGrams(item, geoG);
    if (!at) return skip("no_grams");
    reading.applied = true;
    return at;
  });
  return { items: out, readings };
}
