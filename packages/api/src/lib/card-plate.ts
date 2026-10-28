// "Card measures the plate" (docs/dishware.md): an ID-1 card (85.6 x 54 mm) lying beside the plate is a ruler, and
// the plate's real diameter goes into the scan prompt like a registered plate of "Piring saya" does, so the
// user registers nothing.
//
// A separate small vision call beside the scan (never a rule inside the scan prompt: that broke item keys, see
// docs/scale-readout.md), same model, temperature 0. The model only points: the card's four corners and the plate's
// box, both on the 0-1000 grid. Everything numeric happens here: the grid is stretched by the photo's aspect ratio,
// so pixels come from the real width and height; the card's long side in pixels gives pixels per cm; the plate's
// major axis divided by that is the diameter. A card that is not card-shaped, a plate that is cut off or not round
// or outside 12-34 cm means no diameter, and the scan is the one the user would have had without this.
//
// Ordering (docs/ai-accuracy-log.md 2026-10-28): the scan starts at once, the measure runs beside it; when it
// finds a usable diameter the scan is run again with the plate text and the first answer is dropped. A photo with no
// card never waits for the measure; a photo with one pays the measure plus a second scan.
import { imageSize } from "./image-size";
import type { ImageSize } from "./image-size";
import { CARD_LONG_SIDE_CM } from "./dishware";
import type { PromptDishware } from "./dishware";
import { DEFAULT_VISION_MODEL, defaultSchedule, extractJson, extractUsage, responseText } from "./vision";
import type { AiRunner, ScheduleTimeout, VisionEvent } from "./vision";

/** [ymin, xmin, ymax, xmax] on the 0-1000 grid, the order every box of the scan uses. */
export type GridBox = [number, number, number, number];
type Point = readonly [number, number];

/** A plate or bowl this size is believable on a table: a 12 cm saucer or small bowl up to a 34 cm platter. */
export const PLATE_MIN_CM = 12;
export const PLATE_MAX_CM = 34;
/** A bowl is smaller than a platter: wider than this is a wrong card or box (bowls of 25-27 cm came out of misread cards, 2026-10-28). */
export const BOWL_MAX_CM = 24;
/** Long over short side of an ID-1 card is 1.586; a tilted or foreshortened one still reads inside these limits. */
const CARD_ASPECT_MIN = 1.27;
const CARD_ASPECT_MAX = 2.06;
/** Opposite sides of the card's quadrilateral may differ this much (perspective); more is a wrongly placed corner. */
const CARD_EDGE_SKEW = 1.35;
/** The card spans 4-70% of the photo's longer side: smaller is unreadable, larger is not a card beside a plate. */
const CARD_SPAN_MIN = 0.04;
const CARD_SPAN_MAX = 0.7;
/** A box side this close to the photo's border means the plate is cut off by it. */
const BORDER_GRID = 6;
/** A plate's short over long box side below this is no round plate (or the box is wrong). */
const MIN_ROUNDNESS = 0.6;

const MEASURE_TIMEOUT_MS = 8_000;
/** A streamed scan holds its first items back this long for the measure's verdict; after it they show and a verdict that comes later resets them. */
const HOLD_MS = 2_500;
/** A scan that has finished waits this much longer for the measure; a photo without a card must not wait for a stalled call. */
const LATE_MS = 1_500;

export const MEASURE_PROMPT = `Lihat foto ini. Jawab HANYA JSON valid satu baris tanpa teks lain:
{"card":{"seen":true atau false,"corners":[[x,y],[x,y],[x,y],[x,y]]},"plate":{"kind":"flat atau bowl atau none","box":[ymin,xmin,ymax,xmax]}}
card: kartu plastik berukuran standar (kartu ATM, debit, kredit, KTP, SIM, e-money; persegi panjang bersudut membulat) yang tergeletak rata di permukaan yang sama dengan makanan. Ragu, tertutup sebagian, terpotong tepi foto, atau benda lain yang mirip kartu = seen false dan corners null.
corners: keempat sudut kartu, mulai dari sudut kiri atas lalu searah jarum jam. Tiap sudut [x,y] pada skala 0-1000 (x dari kiri ke kanan, y dari atas ke bawah) dan tepat di pojok kartu, bukan di tengah.
plate: piring atau mangkuk yang menjadi alas makanan. kind flat = piring datar, bowl = mangkuk, none = tidak ada piring atau mangkuk di bawah makanan. Timbangan dapur, talenan, nampan, kantong plastik, kemasan, tangan, dan meja BUKAN piring atau mangkuk: tulis none (box null). box = kotak pas di sekeliling tepi luar piring atau mangkuk, skala 0-1000.`;

export type SkipReason =
  | "no_size"
  | "late"
  | "no_consensus"
  | "timeout"
  | "error"
  | "unparseable"
  | "no_card"
  | "card_corners"
  | "card_shape"
  | "card_size"
  | "no_plate"
  | "plate_box"
  | "plate_cut_off"
  | "not_round"
  | "implausible_diameter"
  | "rescan_failed";

/** What the model wrote, validated for shape only. */
export type RawMeasure = {
  seen: boolean;
  corners: Point[] | null;
  kind: "flat" | "bowl" | "none" | null;
  box: GridBox | null;
};

export type CardPlateOutcome = {
  /** The model said a card lies beside the food. */
  seen: boolean;
  card?: { box: GridBox; aspect: number; longPx: number; pxPerCm: number; width: number; height: number };
  plate?: { kind: "flat" | "bowl"; box: GridBox; clipped?: "x" | "y" };
  diameterCm?: number;
  /** The diameter of each call when two were combined (or compared and disagreed). */
  diameters?: number[];
  /** A diameter was measured and handed to the scan. */
  used: boolean;
  skipped?: SkipReason;
};

const isPoint = (p: unknown): p is Point =>
  Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n));

function gridBox(raw: unknown): GridBox | null {
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [ymin, xmin, ymax, xmax] = (raw as number[]).map((n) => Math.min(1000, Math.max(0, n))) as GridBox;
  return ymax > ymin && xmax > xmin ? [ymin, xmin, ymax, xmax] : null;
}

/** The model's answer, or null when it is not a JSON object with a card field. */
export function parseMeasureAnswer(text: string): RawMeasure | null {
  let parsed: unknown;
  try {
    parsed = extractJson(text.replace(/```(?:json)?/g, ""));
  } catch {
    return null;
  }
  const answer = parsed as { card?: { seen?: unknown; corners?: unknown }; plate?: { kind?: unknown; box?: unknown } } | null;
  if (!answer || typeof answer !== "object" || !answer.card || typeof answer.card !== "object") return null;
  const corners = answer.card.corners;
  const kind = typeof answer.plate?.kind === "string" ? answer.plate.kind.trim().toLowerCase() : null;
  return {
    seen: answer.card.seen === true,
    corners: Array.isArray(corners) && corners.length === 4 && corners.every(isPoint) ? (corners as Point[]) : null,
    kind: kind === "flat" || kind === "bowl" || kind === "none" ? kind : null,
    box: gridBox(answer.plate?.box),
  };
}

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/** The card quadrilateral in pixels, its long side and aspect; a skip reason when it is no believable card. */
function readCard(corners: Point[], size: ImageSize): NonNullable<CardPlateOutcome["card"]> | SkipReason {
  const px = corners.map(([x, y]): Point => [(x * size.width) / 1000, (y * size.height) / 1000]);
  const cx = px.reduce((s, p) => s + p[0], 0) / 4;
  const cy = px.reduce((s, p) => s + p[1], 0) / 4;
  // The order the model wrote is not trusted: sort around the centre.
  const ring = [...px].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  const turns = ring.map((p, i) => {
    const q = ring[(i + 1) % 4]!;
    const r = ring[(i + 2) % 4]!;
    return (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
  });
  if (!(turns.every((t) => t > 0) || turns.every((t) => t < 0))) return "card_corners";
  const [e0, e1, e2, e3] = ring.map((p, i) => dist(p, ring[(i + 1) % 4]!)) as [number, number, number, number];
  if (Math.max(e0, e2) / Math.min(e0, e2) > CARD_EDGE_SKEW || Math.max(e1, e3) / Math.min(e1, e3) > CARD_EDGE_SKEW) return "card_shape";
  const a = (e0 + e2) / 2;
  const b = (e1 + e3) / 2;
  const longPx = Math.max(a, b);
  const aspect = longPx / Math.min(a, b);
  if (aspect < CARD_ASPECT_MIN || aspect > CARD_ASPECT_MAX) return "card_shape";
  const span = longPx / Math.max(size.width, size.height);
  if (span < CARD_SPAN_MIN || span > CARD_SPAN_MAX) return "card_size";
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return {
    box: [Math.min(...ys), Math.min(...xs), Math.max(...ys), Math.max(...xs)].map((n) => Math.round(n)) as GridBox,
    aspect: round(aspect, 2),
    longPx: round(longPx, 1),
    pxPerCm: longPx / CARD_LONG_SIDE_CM,
    width: size.width,
    height: size.height,
  };
}

/**
 * The plate's diameter from what the model pointed at. Pure: the same answer and photo size always give the same
 * outcome, which is what the tests and the harness rely on.
 */
export function measureFromAnswer(raw: RawMeasure, size: ImageSize): CardPlateOutcome {
  if (!raw.seen) return { seen: false, used: false, skipped: "no_card" };
  if (!raw.corners) return { seen: true, used: false, skipped: "card_corners" };
  const card = readCard(raw.corners, size);
  if (typeof card === "string") return { seen: true, used: false, skipped: card };
  if (raw.kind === "none") return { seen: true, card, used: false, skipped: "no_plate" };
  if (!raw.box || raw.kind === null) return { seen: true, card, used: false, skipped: "plate_box" };
  const [ymin, xmin, ymax, xmax] = raw.box;
  const plate = { kind: raw.kind, box: raw.box } as NonNullable<CardPlateOutcome["plate"]>;
  const widthPx = ((xmax - xmin) * size.width) / 1000;
  const heightPx = ((ymax - ymin) * size.height) / 1000;
  const xCut = xmin <= BORDER_GRID || xmax >= 1000 - BORDER_GRID;
  const yCut = ymin <= BORDER_GRID || ymax >= 1000 - BORDER_GRID;
  if (xCut && yCut) return { seen: true, card, plate, used: false, skipped: "plate_cut_off" };
  // A side the photo's border cuts is a lower bound, not the plate: the other side is the diameter then.
  let majorPx: number;
  if (xCut || yCut) {
    majorPx = xCut ? heightPx : widthPx;
    plate.clipped = xCut ? "x" : "y";
  } else {
    if (Math.min(widthPx, heightPx) / Math.max(widthPx, heightPx) < MIN_ROUNDNESS) return { seen: true, card, plate, used: false, skipped: "not_round" };
    majorPx = Math.max(widthPx, heightPx);
  }
  const diameterCm = round(majorPx / card.pxPerCm, 1);
  if (diameterCm < PLATE_MIN_CM || diameterCm > (plate.kind === "bowl" ? BOWL_MAX_CM : PLATE_MAX_CM)) return { seen: true, card, plate, diameterCm, used: false, skipped: "implausible_diameter" };
  return { seen: true, card, plate, diameterCm, used: true };
}

/** What the measure returned: the outcome and what the calls cost. Never an error: a failed call is a skipped outcome. */
export type CardPlateResult = {
  outcome: CardPlateOutcome;
  /** Token counts of every call that answered, summed. */
  usage: Record<string, unknown> | null;
  ms: number;
  error?: string;
  /** A call was asked again at once after a malformed answer. */
  retried?: true;
};

/**
 * Two answers about one photo that disagree by more than this are no measurement. Gemma's card box is not stable: on
 * 12 calls at temperature 0 on one photo 4 gave a card box that made the plate 27.5 cm and 8 gave 18.5-19.1 cm (the
 * 2026-10-28 log entry), so one call cannot be trusted and two that agree can.
 */
const MAX_DISAGREEMENT = 0.1;
/** Calls asked per photo, in parallel. */
const MEASURE_CALLS = 2;

/** One verdict out of the calls' outcomes: two used diameters that agree are averaged; anything else that differs is no_consensus. */
export function combineOutcomes(outcomes: readonly CardPlateOutcome[]): CardPlateOutcome {
  const [first, second] = outcomes;
  if (!first) return { seen: false, used: false, skipped: "error" };
  if (!second) return first.used ? { ...first, used: false, skipped: "no_consensus" } : first;
  if (first.used && second.used) {
    const a = first.diameterCm!;
    const b = second.diameterCm!;
    const diameters = [a, b];
    if (first.plate!.kind === second.plate!.kind && Math.abs(a - b) / Math.max(a, b) <= MAX_DISAGREEMENT) {
      return { ...first, diameterCm: round((a + b) / 2, 1), diameters };
    }
    const { diameterCm: _dropped, ...rest } = first;
    return { ...rest, used: false, skipped: "no_consensus", diameters };
  }
  if (!first.used && !second.used && first.skipped === second.skipped) return first;
  const diameters = [first, second].flatMap((o) => (o.diameterCm !== undefined ? [o.diameterCm] : []));
  const { diameterCm: _dropped, ...rest } = first;
  return { ...rest, seen: first.seen || second.seen, used: false, skipped: "no_consensus", ...(diameters.length > 0 ? { diameters } : {}) };
}

/** Token counts of the calls that answered, added up (nested objects of the first call are kept as they are). */
function sumUsage(list: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> | null {
  if (list.length === 0) return null;
  const total: Record<string, unknown> = {};
  for (const usage of list) {
    for (const [key, value] of Object.entries(usage)) {
      total[key] = typeof value === "number" && typeof total[key] === "number" ? total[key] + value : (total[key] ?? value);
    }
  }
  return total;
}

/**
 * Extra vision calls on the same photo: two at once, whose answers must agree (combineOutcomes). Never throws: every
 * failure (no readable photo size, timeout, unparseable answer) is a skipped outcome and the scan goes on as it would
 * without it. A call that fails or answers something unreadable is asked once more at once; the deadline ends all of it.
 */
export async function measureCardPlate(
  ai: AiRunner,
  opts: {
    imageBase64: string;
    mimeType: string;
    /** The photo's bytes, for the header size. */
    bytes: Uint8Array | ArrayBuffer;
    model?: string;
    schedule?: ScheduleTimeout;
    timeoutMs?: number;
  },
): Promise<CardPlateResult> {
  const startedAt = Date.now();
  const size = imageSize(opts.bytes);
  if (!size) return { outcome: { seen: false, used: false, skipped: "no_size" }, usage: null, ms: 0 };
  const request = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: MEASURE_PROMPT },
          { type: "image_url", image_url: { url: `data:${opts.mimeType};base64,${opts.imageBase64}` } },
        ],
      },
    ],
    max_tokens: 200,
    temperature: 0,
    chat_template_kwargs: { enable_thinking: false },
  };
  const schedule = opts.schedule ?? defaultSchedule;
  const { promise: deadline, reject: expire } = Promise.withResolvers<never>();
  deadline.catch(() => {});
  const cancelDeadline = schedule(() => expire(new Error("measure-timeout")), opts.timeoutMs ?? MEASURE_TIMEOUT_MS);
  const usage: Array<Record<string, unknown>> = [];
  let retried = false;
  const attempt = async (): Promise<RawMeasure> => {
    const run = ai.run(opts.model || DEFAULT_VISION_MODEL, request);
    run.catch(() => {});
    const result = await run;
    const sum = extractUsage(result);
    if (sum) usage.push(sum);
    const text = responseText(result);
    if (text === null) throw new Error("no text in response");
    const raw = parseMeasureAnswer(text);
    if (!raw) throw new Error("unparseable");
    return raw;
  };
  const ask = async (): Promise<RawMeasure> => {
    try {
      return await attempt();
    } catch {
      retried = true;
      return await attempt();
    }
  };
  try {
    const settled = await Promise.allSettled(Array.from({ length: MEASURE_CALLS }, () => Promise.race([ask(), deadline])));
    const raws = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    const failure = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    if (raws.length === 0) throw failure?.reason ?? new Error("failed");
    return {
      outcome: combineOutcomes(raws.map((raw) => measureFromAnswer(raw, size))),
      usage: sumUsage(usage),
      ms: Date.now() - startedAt,
      ...(retried ? { retried: true as const } : {}),
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : "failed";
    console.error(`[card-plate] no measurement: ${error}`);
    const skipped: SkipReason = error === "measure-timeout" ? "timeout" : error === "unparseable" ? "unparseable" : "error";
    return {
      outcome: { seen: false, used: false, skipped },
      usage: sumUsage(usage),
      ms: Date.now() - startedAt,
      error,
      ...(retried ? { retried: true as const } : {}),
    };
  } finally {
    cancelDeadline();
  }
}

// ------------------------------------------------------------------ the scan prompt

/** A plate whose size the card measured: what the scan prompt is told. */
export type MeasuredPlate = { diameterCm: number; kind: "flat" | "bowl" };

/** The measured plate when the call found one; undefined = the scan stays as it is. */
export function plateOf(result: CardPlateResult | null | undefined): MeasuredPlate | undefined {
  const { outcome } = result ?? {};
  return outcome?.used && outcome.diameterCm !== undefined && outcome.plate
    ? { diameterCm: outcome.diameterCm, kind: outcome.plate.kind }
    : undefined;
}

/** The name the plate answer carries; `dishwareInstruction` writes it into the prompt like a registered plate. */
export const MEASURED_PLATE_NAME = "piring di foto";
export const MEASURED_PLATE_ID = "card";

export function measuredPromptPlate(plate: MeasuredPlate): PromptDishware {
  return {
    name: MEASURED_PLATE_NAME,
    kind: plate.kind,
    diameterCm: plate.diameterCm,
    description: "piring atau mangkuk tempat makanan di foto ini, ukurannya diukur dari kartu di foto",
  };
}

// ------------------------------------------------------------------ ordering

/**
 * Runs the scan beside the measure. `run(undefined)` starts at once; when the measure finds a plate the first answer is
 * dropped and `run(plate)` answers instead, so a photo without a card never waits for the measure. A stream's first
 * events are held until the verdict (HOLD_MS at most); after that they show, and a late verdict resets them. If the
 * second scan fails the first answer stands. `measure` null = nothing to measure: the scan alone, untouched.
 */
export async function scanWithMeasuredPlate<T>(opts: {
  measure: Promise<CardPlateResult> | null;
  run: (plate: MeasuredPlate | undefined, onEvent: ((event: VisionEvent) => void) | undefined) => Promise<T>;
  onEvent?: (event: VisionEvent) => void;
  holdMs?: number;
  /** Infinity = never give up on the measure (the eval harness replays scans from a cache, so its scans finish at once). */
  lateMs?: number;
  schedule?: ScheduleTimeout;
}): Promise<{ value: T; result: CardPlateResult | null; plate?: MeasuredPlate; rescanFailed?: true }> {
  const { measure, run, onEvent } = opts;
  if (!measure) return { value: await run(undefined, onEvent), result: null };
  let mode: "hold" | "open" | "dropped" = "hold";
  let shown = false;
  const held: VisionEvent[] = [];
  const gate = onEvent
    ? (event: VisionEvent) => {
        if (mode === "hold") held.push(event);
        else if (mode === "open") {
          shown = true;
          onEvent(event);
        }
      }
    : undefined;
  const open = () => {
    if (mode !== "hold") return;
    mode = "open";
    for (const event of held.splice(0)) {
      shown = true;
      onEvent?.(event);
    }
  };
  const cancelHold = onEvent ? (opts.schedule ?? defaultSchedule)(open, opts.holdMs ?? HOLD_MS) : () => {};
  const first = run(undefined, gate);
  first.catch(() => {});
  const startedAt = Date.now();
  const schedule = opts.schedule ?? defaultSchedule;
  // The scan itself finished: the measure gets a short grace and is then given up on (no waiting on a stalled call).
  const lateMs = opts.lateMs ?? LATE_MS;
  const late = new Promise<CardPlateResult>((resolve) => {
    if (!Number.isFinite(lateMs)) return;
    first.then(
      () => schedule(() => resolve({ outcome: { seen: false, used: false, skipped: "late" }, usage: null, ms: Date.now() - startedAt }), lateMs),
      () => {},
    );
  });
  const result = await Promise.race([measure, late]);
  cancelHold();
  const plate = plateOf(result);
  if (!plate) {
    open();
    return { value: await first, result };
  }
  if (shown) onEvent?.({ type: "reset" });
  mode = "dropped";
  held.length = 0;
  try {
    return { value: await run(plate, onEvent), result, plate };
  } catch (error) {
    try {
      return { value: await first, result, rescanFailed: true };
    } catch {
      throw error;
    }
  }
}

// ------------------------------------------------------------------ ledger

/**
 * `usage_json.cardPlate`: what the measure call saw and what became of it, so detection, diameters and skips can be
 * counted from prod without photos. `rescanned`: the scan was run a second time with the plate text.
 */
export function cardPlateLedger(result: CardPlateResult, extra: { rescanned?: boolean; rescanFailed?: boolean } = {}) {
  const { outcome } = result;
  return {
    seen: outcome.seen,
    ...(outcome.card ? { card: { box: outcome.card.box, aspect: outcome.card.aspect } } : {}),
    ...(outcome.plate ? { plate: outcome.plate } : {}),
    ...(outcome.diameterCm !== undefined ? { diameterCm: outcome.diameterCm } : {}),
    used: outcome.used && !extra.rescanFailed,
    ...(outcome.skipped || extra.rescanFailed ? { skipped: extra.rescanFailed ? "rescan_failed" : outcome.skipped } : {}),
    ms: result.ms,
    usage: result.usage,
    ...(result.retried ? { retried: true } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(extra.rescanned ? { rescanned: true } : {}),
  };
}
