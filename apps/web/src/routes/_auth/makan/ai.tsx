import {
  Camera,
  Check,
  ChevronDown,
  Drumstick,
  Images,
  Lightbulb,
  Loader2,
  Mic,
  RefreshCw,
  ScanBarcode,
  ShieldCheck,
  ThumbsUp,
  TriangleAlert,
  X,
} from "lucide-react";
import confetti from "canvas-confetti";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { fmtPercent, getActiveLocale, i18n } from "@joyorogo/i18n";

import {
  MEAL_LABELS,
  effectiveRamadan,
  jakartaToday,
  slotsFor,
  suggestMealForDish,
  suggestMealNow,
} from "@joyorogo/api/lib/engine";
import { isHeavyDish } from "@joyorogo/api/lib/food-kind";
import { randomFact } from "@joyorogo/api/lib/facts";
import { scanFailReason } from "@joyorogo/api/lib/scan-errors";
import type { ScanFailReason } from "@joyorogo/api/lib/scan-errors";
import { analyzeStreaming } from "@joyorogo/api/lib/scan-live";
import type { LiveRow } from "@joyorogo/api/lib/scan-live";
import { parseIdrInput } from "@joyorogo/api/lib/format";
import type { Meal } from "@joyorogo/api/lib/engine";
import { eatenAtClock, eatenAtFromClock } from "@joyorogo/api/lib/eaten-at";
import { scalePortion } from "@joyorogo/api/lib/portion";
import { modelNumbers, swapPortionPrior, withoutPortionPrior } from "@joyorogo/api/lib/portion-chip";
import { swapScaleRead, withoutScaleRead } from "@joyorogo/api/lib/scale-chip";
import { dominantKind } from "@joyorogo/api/lib/snack-advice";
import type { FoodKind } from "@joyorogo/api/lib/food-kind";
import { cupPick } from "@joyorogo/api/lib/drink-options";
import type { CupChoice } from "@joyorogo/api/lib/drink-options";
import { CupChoices } from "@/components/scan/cup-choices";
import { PortionPriorChips } from "@/components/scan/portion-prior-chips";
import { MemoryChips } from "@/components/scan/memory-chips";
import { ScaleReadChips } from "@/components/scan/scale-read-chips";
import { Button, buttonVariants } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { Checkbox } from "@joyorogo/ui/components/checkbox";
import {
  Card,
  FieldLabel,
  ListGroup,
  Page,
  PageHeader,
  SectionTitle,
  Segmented,
} from "@/components/kit/surface";
import { PlateNote } from "@/components/dishware/plate-note";
import type { PlateNoteData } from "@/components/dishware/plate-note";
import { EatenAtField } from "@/components/plate/eaten-at-field";
import { IdrInput } from "@/components/plate/idr-input";
import { SaveLocationToggle } from "@/components/places/location-toggle";
import { CORRECTED_ROW_CLASS, CorrectBadge, CorrectBox } from "@/components/scan/correct-box";
import type { CorrectScanResult, CorrectionKind } from "@/components/scan/correct-box";
import { LiveRows } from "@/components/scan/live-rows";
import { CountUp } from "@/components/kit/count-up";
import { STICKER_FILTER, stickerUrl } from "@/components/sticker";
import { ShareStoryButton } from "@/components/story/share-story-button";
import { cropItems } from "@/lib/crop";
import type { ItemBox } from "@/lib/crop";
import { useMaternalInfo } from "@/components/maternal/use-maternal";
import { useGain } from "@/components/gain/use-gain";
import { FoodSafetyNotes } from "@/components/maternal/food-safety-notes";
import { MacroLine } from "@/components/macro-line";
import type { AiFoodItem } from "@/lib/api-types";
import { KindCycleChip, SnackAdviceCard, useSnackAdvice } from "@/components/makan/snack-advice";
import { isPaywallError } from "@/lib/billing";
import { fmtGramsLabel, fmtInt, parseNum } from "@/lib/format";
import { usePlaceLocation } from "@/lib/location";
import { ReferenceHint } from "@/components/scan/reference-hint";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/makan/ai")({
  // The makan page forwards its DaySwitcher day (?date=), so a scan taken
  // while browsing a past day lands on that day, not on hari ini.
  validateSearch: (search: Record<string, unknown>): { date?: string } => {
    const raw = typeof search.date === "string" ? search.date : undefined;
    return { date: raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined };
  },
  component: AiFoodPage,
});

const GEPREK_KCAL = 600;

/** Optional chips for the negative answers of "Hasilnya akurat?". */
const FEEDBACK_REASONS = ["porsi", "makanan", "kcal_tinggi", "kcal_rendah"] as const;

type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

/**
 * A failed scan call. A server reason code selects the copy from the
 * `scan:fail.reason` keys; any other error keeps its (already localized)
 * message.
 */
type ScanFailure = { reason: ScanFailReason | null; message: string | null };

function failureOf(err: unknown, fallback: string): ScanFailure {
  const reason = scanFailReason(err);
  return { reason, message: reason ? null : err instanceof Error ? err.message : fallback };
}

/** Which line of the signature reaction fits this total (the gimmick people screenshot). */
function reactionKey(totalKcal: number): "high" | "mid" | "low" {
  if (totalKcal > 1100) return "high";
  if (totalKcal > 550) return "mid";
  return "low";
}

/** Collapsed-by-default block for explanations, so the numbers stay on one screen. */
function Disclosure({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("group rounded-3xl bg-card", className)}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-3xl px-5 text-sm font-bold select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-2 px-5 pb-4 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}
const BRAND_COLORS = ["#2e7d46", "#7fd89b", "#f59e0b", "#ffffff"];

/** Tiered celebration: the bigger the meal, the bigger the party. */
function celebrate(totalKcal: number) {
  const defaults = { colors: BRAND_COLORS, disableForReducedMotion: true };
  if (totalKcal > 1100) {
    confetti({ ...defaults, particleCount: 200, spread: 120, origin: { x: 0.5, y: 0.6 } });
    confetti({ ...defaults, particleCount: 80, angle: 60, spread: 60, origin: { x: 0, y: 0.7 } });
    confetti({ ...defaults, particleCount: 80, angle: 120, spread: 60, origin: { x: 1, y: 0.7 } });
  } else if (totalKcal > 550) {
    confetti({ ...defaults, particleCount: 120, spread: 90, origin: { x: 0.5, y: 0.6 } });
  } else {
    confetti({ ...defaults, particleCount: 60, spread: 70, origin: { x: 0.5, y: 0.6 } });
  }
}

const MAX_EDGE = 1024;

// Phase timings of the previous scan (this session only), reported with the
// next analyzeFood request; cleared once sent.
let sessionTiming: {
  prevRoundTripMs?: number;
  prevRenderMs?: number;
  prevCropMs?: number;
  prevFirstNameMs?: number;
  prevFirstItemMs?: number;
} = {};

type SentImage = {
  base64: string;
  mimeType: "image/jpeg" | "image/webp";
  /** Same pixels as `base64`; cropping decodes this instead of a data URL. */
  blob: Blob;
  /** Decode + downscale time, and encode + base64 time, in ms. */
  resizeMs: number;
  encodeMs: number;
};

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  const { promise, resolve } = Promise.withResolvers<Blob | null>();
  canvas.toBlob(resolve, type, quality);
  return promise;
}

function blobToBase64(blob: Blob) {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onload = () => {
    const url = reader.result as string;
    resolve(url.slice(url.indexOf(",") + 1));
  };
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
  return promise;
}

/**
 * Client-side resize to <= 1024 px; WebP when the browser can encode it
 * (smaller upload on 4G), JPEG fallback elsewhere. The bitmap is decoded
 * straight at the target size and encoded off the main thread (toBlob).
 * Inference cost is driven by pixel count, so the edge cap is what keeps it
 * cheap. The original is only kept when the user turned on "Simpan foto asli".
 */
async function fileToImageBase64(file: File): Promise<SentImage> {
  const startedAt = performance.now();
  const source = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    source.close();
    throw new Error(i18n.t("scan:flow.imageUnsupported"));
  }
  // Flatten alpha onto white — gallery cutouts/screenshots with transparency
  // get rejected by the vision model otherwise ("could not be decoded").
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(source, 0, 0, width, height);
  source.close();
  const resizeMs = Math.round(performance.now() - startedAt);
  const webp = await canvasToBlob(canvas, "image/webp", 0.82);
  if (webp?.type === "image/webp") {
    const base64 = await blobToBase64(webp);
    const encodeMs = Math.round(performance.now() - startedAt) - resizeMs;
    return { base64, mimeType: "image/webp", blob: webp, resizeMs, encodeMs };
  }
  const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.85);
  if (!jpeg) throw new Error(i18n.t("scan:flow.processFailed"));
  const base64 = await blobToBase64(jpeg);
  const encodeMs = Math.round(performance.now() - startedAt) - resizeMs;
  return { base64, mimeType: "image/jpeg", blob: jpeg, resizeMs, encodeMs };
}

function sameBox(a: AiFoodItem["box"], b: AiFoodItem["box"]) {
  return !!a && !!b && a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Items and kcal inputs as they were before "Setengah porsi". */
type FullPortion = { items: AiFoodItem[]; kcals: Record<number, string> };

/** The original AI answer and, per current row, the item that row descends from (null = added). */
type AiBaseline = { list: AiFoodItem[]; rows: Array<AiFoodItem | null> };

/** Everything per-row that a correction rewrites, so "Urungkan" restores it whole. */
type CorrectionSnapshot = {
  items: AiFoodItem[];
  kcals: Record<number, string>;
  kinds: Record<number, FoodKind>;
  crops: Array<string | null>;
  stickers: Array<string | null>;
  fullPortion: FullPortion | null;
  corrected: AiBaseline | null;
};

const NO_CHANGES: Record<number, CorrectionKind> = {};
const MAX_UNDO = 10;

/**
 * Rectangular crop as the instant placeholder; once the real background-removed
 * sticker has loaded it fades in and the crop fades out. A refined sticker that
 * replaces the quick one fades in over it, so the tile never flashes back to
 * the crop.
 */
function CutoutImage({
  crop,
  sticker,
  name,
  className,
}: {
  crop: string | null | undefined;
  sticker: string | null | undefined;
  name: string;
  className?: string;
}) {
  // `shown` is the newest sticker id that finished loading; `under` keeps the
  // one it replaces on screen until the fade-in is done.
  const [shown, setShown] = useState<string | null>(null);
  const [under, setUnder] = useState<string | null>(null);
  useEffect(() => {
    if (sticker) return;
    setShown(null);
    setUnder(null);
  }, [sticker]);
  const onLoaded = (id: string) => {
    if (shown === id) return;
    setUnder(shown);
    setShown(id);
    setTimeout(() => setUnder(null), 350);
  };
  const underId = shown && shown !== sticker ? shown : under;
  const layer =
    "absolute inset-0 size-full object-contain p-0.5 transition-opacity duration-300 motion-reduce:transition-none";
  return (
    <div className={cn("relative", className)}>
      {crop && (
        <img
          src={crop}
          alt={name}
          aria-hidden={name === ""}
          className={cn(
            "size-full rounded-[inherit] object-cover shadow-sm transition-opacity duration-300 motion-reduce:transition-none",
            shown && "opacity-0",
          )}
        />
      )}
      {underId && (
        <img src={stickerUrl(underId)} alt="" aria-hidden style={STICKER_FILTER} className={layer} />
      )}
      {sticker && (
        <img
          key={sticker}
          src={stickerUrl(sticker)}
          alt=""
          aria-hidden
          onLoad={() => onLoaded(sticker)}
          style={STICKER_FILTER}
          className={cn(layer, shown === sticker ? "opacity-100" : "opacity-0")}
        />
      )}
    </div>
  );
}

function AiFoodPage() {
  const { t } = useTranslation(["scan", "makan", "common"]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The day the scan belongs to, forwarded from the makan page's DaySwitcher.
  const { date: scanDate } = Route.useSearch();
  const maternalInfo = useMaternalInfo();
  const { gain } = useGain();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "preparing" | "analyzing" | "confirm">("idle");
  // What the model has found so far while phase is "analyzing" (analyzeFoodStream).
  const [liveRows, setLiveRows] = useState<LiveRow[]>([]);
  const [items, setItems] = useState<AiFoodItem[]>([]);
  const [kcals, setKcals] = useState<Record<number, string>>({});
  // The exact pixels the AI saw: boxes map onto this, and it is what gets saved.
  const [image, setImage] = useState<SentImage | null>(null);
  const [crops, setCrops] = useState<Array<string | null>>([]);
  // Ids of the real cutouts (ai.scanSticker), parallel to items; null until ready.
  const [stickers, setStickers] = useState<Array<string | null>>([]);
  const stickerRunRef = useRef(0);
  // Crops are cut after the result is on screen; tiles shimmer until then.
  const [cropping, setCropping] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const ramadan = effectiveRamadan(profile.data?.profile?.ramadanMode);
  const MEALS = (Object.entries(MEAL_LABELS) as Array<[Meal, string]>).filter(([meal]) =>
    slotsFor(ramadan).includes(meal),
  );
  const [meal, setMeal] = useState<Meal>(suggestMealNow(new Date(), ramadan));
  // Once the user picks a slot, a rescan must not overwrite it.
  const mealPickedRef = useRef(false);
  const [scanError, setScanError] = useState<ScanFailure | null>(null);
  // The photo held more food than fit: the result keeps the most prominent
  // items and shows guidance until the user keeps them or reshoots.
  const [tooMany, setTooMany] = useState(false);
  const [plateNote, setPlateNote] = useState<PlateNoteData | null>(null);
  const [fact] = useState(() => randomFact());
  const [saving, setSaving] = useState(false);
  // This scan used the free user's last quota of today: show the (skippable)
  // Founder offer once the results are saved.
  const [quotaReached, setQuotaReached] = useState(false);
  // Hitung ulang: the server keeps the photo, a retry sends only its id and
  // never spends the daily quota. The previous result stays on screen while
  // one runs and stays for good when one fails.
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [retriesLeft, setRetriesLeft] = useState(0);
  const [retryHint, setRetryHint] = useState("");
  const [memoryChips, setMemoryChips] = useState<string[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<ScanFailure | null>(null);
  const retryAbortRef = useRef<AbortController | null>(null);
  // "Hasilnya akurat?" — shown when the server asks (every scan for the
  // first 3, then once per WIB day). Never blocks saving; answering or
  // dismissing hides the card; "Hitung ulang" is logged server-side as a retry.
  const [model, setModel] = useState<string | null>(null);
  const [askFeedback, setAskFeedback] = useState(false);
  const [feedbackAnswered, setFeedbackAnswered] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState<"kurang_akurat" | "salah" | null>(null);
  const [feedbackReasons, setFeedbackReasons] = useState<FeedbackReason[]>([]);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackKeepPhoto, setFeedbackKeepPhoto] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  // Price attaches to the whole plate, not per item: one number per photo.
  // Optional "Jam makan" (unix ms); null = now, nothing is sent.
  const [eatenAt, setEatenAt] = useState<number | null>(null);
  const [plateName, setPlateName] = useState("");
  const [platePlace, setPlatePlace] = useState("");
  const [platePrice, setPlatePrice] = useState("");
  const placeLocation = usePlaceLocation();

  // Live total of the (editable) per-item kcal — drives the big number
  // and the reaction line on the confirm screen.
  const totalKcal = items.reduce(
    (sum, item, index) => sum + (parseNum(kcals[index] ?? String(item.kcal)) ?? 0),
    0,
  );

  // Item kind: the AI's call, or what the user tapped on the row. Advice only.
  const [kinds, setKinds] = useState<Record<number, FoodKind>>({});
  // Items and kcal inputs as they were before "Setengah porsi", so one tap restores them.
  const [fullPortion, setFullPortion] = useState<FullPortion | null>(null);
  const fullItems = fullPortion?.items ?? null;
  // What the AI said, for the stored breakdown and the miss log.
  const aiItems = fullItems ?? items;
  // Correction box ("Ada yang kurang pas?"). A correction reshapes the list but
  // never the AI baseline: `corrected` keeps the original answer (`list`, what
  // addScan stores) and, per current row, the baseline item that row descends
  // from (`rows`, null for an added row) so the miss log keeps counting it.
  const [corrected, setCorrected] = useState<AiBaseline | null>(null);
  const baseList = corrected?.list ?? aiItems;
  const baseRows: ReadonlyArray<AiFoodItem | null | undefined> = corrected?.rows ?? aiItems;
  const [undoStack, setUndoStack] = useState<CorrectionSnapshot[]>([]);
  // Rows the last correction touched; they stay highlighted until the next
  // interaction with the list.
  const [changed, setChanged] = useState<Record<number, CorrectionKind>>(NO_CHANGES);
  const [correctionNote, setCorrectionNote] = useState<string | null>(null);
  const [correctionsLeft, setCorrectionsLeft] = useState<number | null>(null);
  const touchList = () => {
    setChanged(NO_CHANGES);
    setCorrectionNote(null);
  };
  const advice = useSnackAdvice({
    date: scanDate,
    kcal: totalKcal,
    kind: dominantKind(items.map((item, index) => kinds[index] ?? item.kind)),
    slot: meal,
    name:
      items.length > 1
        ? t("result.names.andMore", { first: items[0]!.name, count: items.length - 1 })
        : items[0]?.name,
  });

  const applyItems = (next: AiFoodItem[]) => {
    setItems(next);
    if (next.length > 0 && !mealPickedRef.current) {
      setMeal(suggestMealForDish(new Date(), ramadan, next.some((item) => isHeavyDish(item.name))));
    }
    setKcals(Object.fromEntries(next.map((item, index) => [index, String(item.kcal)])));
    setKinds({});
    setFullPortion(null);
    setCorrected(null);
    setUndoStack([]);
    touchList();
  };

  const halve = () => {
    const scaled = items.map((item, index) => {
      const half = scalePortion(
        {
          kcal: parseNum(kcals[index] ?? String(item.kcal)) ?? 0,
          grams: item.grams ?? null,
          protein: item.protein ?? null,
          carbs: item.carbs ?? null,
          fat: item.fat ?? null,
          fiber: item.fiber ?? null,
        },
        0.5,
      );
      return {
        ...item,
        portionPrior: undefined,
        scaleRead: undefined,
        kcal: half.kcal,
        grams: half.grams ?? undefined,
        protein: half.protein ?? undefined,
        carbs: half.carbs ?? undefined,
        fat: half.fat ?? undefined,
        fiber: half.fiber ?? undefined,
      };
    });
    touchList();
    setFullPortion({ items, kcals });
    setItems(scaled);
    setKcals(Object.fromEntries(scaled.map((item, index) => [index, String(item.kcal)])));
  };

  const undoHalf = () => {
    if (!fullPortion) return;
    touchList();
    setItems(fullPortion.items);
    setKcals(fullPortion.kcals);
    setFullPortion(null);
  };

  /** "Porsi kebiasaanmu": one tap puts the model's number or the user's usual portion on the row. */
  const swapPrior = (index: number) => {
    const item = items[index];
    if (!item) return;
    const swapped = swapPortionPrior(item);
    touchList();
    setItems((current) => current.map((it, i) => (i === index ? swapped : it)));
    setKcals((current) => ({ ...current, [index]: String(swapped.kcal) }));
  };

  /** Kitchen-scale readout: one click puts the scale's weight or the photo estimate on the row. */
  const swapScale = (index: number) => {
    const item = items[index];
    if (!item) return;
    const swapped = swapScaleRead(item);
    touchList();
    setItems((current) => current.map((it, i) => (i === index ? swapped : it)));
    setKcals((current) => ({ ...current, [index]: String(swapped.kcal) }));
  };

  /** A cup whose contents the photo hides: the user's drink / size pick replaces the row's numbers. */
  const pickCup = (index: number, next: CupChoice) => {
    touchList();
    const picked = cupPick(next, getActiveLocale());
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...picked } : item)));
    setKcals((current) => ({ ...current, [index]: String(picked.kcal) }));
  };

  // Re-aligns the tiles (crops + cutouts) with a list whose rows moved: kept
  // rows reuse theirs, only rows without one are cut.
  const realignTiles = (
    list: AiFoodItem[],
    reuseCrops: Array<string | null>,
    reuseStickers: Array<string | null>,
  ) => {
    if (!image) return;
    setCrops(reuseCrops);
    const boxes = list.map((item, index) => (reuseCrops[index] ? null : (item.box ?? null)));
    if (boxes.some(Boolean)) {
      const run = runRef.current;
      const url = URL.createObjectURL(image.blob);
      setCropping(true);
      void cropItems(url, boxes)
        .catch(() => boxes.map(() => null))
        .then((cut) => {
          URL.revokeObjectURL(url);
          if (runRef.current !== run) return;
          setCrops((prev) => prev.map((current, index) => current ?? cut[index] ?? null));
          setCropping(false);
        });
    }
    if (photoId) cutStickers(photoId, list, reuseStickers);
    else setStickers(reuseStickers);
  };

  // Applies ai.correctScan in place. `origins` maps every new row to the row
  // it came from, so the per-row state (kcal draft, tapped kind, crop, cutout,
  // baseline) follows it; rows the server touched show their new kcal.
  const applyCorrection = (result: CorrectScanResult, base: AiFoodItem[]): boolean => {
    // The list moved on (Setengah porsi) while the request ran: its origins no longer line up.
    if (base !== items) return false;
    const origins = result.items.map((_, index) => {
      const origin = result.origins[index];
      return origin != null && origin >= 0 && origin < items.length ? origin : null;
    });
    const how = new Map(result.changes.map((change) => [change.index, change.kind]));
    const nextKcals: Record<number, string> = {};
    const nextKinds: Record<number, FoodKind> = {};
    result.items.forEach((item, index) => {
      const origin = origins[index];
      const kind = how.get(index);
      nextKcals[index] = (origin != null && !kind ? kcals[origin] : undefined) ?? String(item.kcal);
      const picked =
        origin != null && (kind === undefined || kind === "portion") ? kinds[origin] : undefined;
      if (picked) nextKinds[index] = picked;
    });
    setUndoStack((stack) => [
      ...stack.slice(-(MAX_UNDO - 1)),
      { items, kcals, kinds, crops, stickers, fullPortion, corrected },
    ]);
    setCorrected({
      list: baseList,
      rows: origins.map((origin) => (origin === null ? null : (baseRows[origin] ?? null))),
    });
    setItems(result.items);
    setMemoryChips([]);
    setKcals(nextKcals);
    setKinds(nextKinds);
    setFullPortion(null);
    setChanged(Object.fromEntries(result.changes.map((change) => [change.index, change.kind])));
    setCorrectionNote(
      [
        result.changes.length > 0 ? t("correct.applied", { count: result.changes.length }) : null,
        result.removed.length > 0 ? t("correct.removed", { names: result.removed.join(", ") }) : null,
      ]
        .filter(Boolean)
        .join(" ") || null,
    );
    setCorrectionsLeft(result.correctionsLeft);
    realignTiles(
      result.items,
      origins.map((origin) => (origin === null ? null : (crops[origin] ?? null))),
      origins.map((origin) => (origin === null ? null : (stickers[origin] ?? null))),
    );
    return true;
  };

  const undoCorrection = () => {
    const snapshot = undoStack.at(-1);
    if (!snapshot) return;
    setUndoStack(undoStack.slice(0, -1));
    setItems(snapshot.items);
    setKcals(snapshot.kcals);
    setKinds(snapshot.kinds);
    setFullPortion(snapshot.fullPortion);
    setCorrected(snapshot.corrected);
    setChanged(NO_CHANGES);
    setCorrectionNote(t("correct.undone"));
    realignTiles(snapshot.items, snapshot.crops, snapshot.stickers);
  };

  // Rules of hooks: this must run on EVERY render, so it lives above the
  // early returns. Confetti fires once per confirm entry, sized by tier.
  const confirmedRef = useRef(false);
  useEffect(() => {
    if (phase === "confirm" && !confirmedRef.current) {
      confirmedRef.current = true;
      celebrate(totalKcal);
    }
    if (phase !== "confirm") confirmedRef.current = false;
  }, [phase, totalKcal]);

  // Incremented on every new shot and on cancel; a late AI response from an
  // abandoned run must never overwrite the current screen. Each run gets its
  // own AbortController so Batalkan/unmount cancels the HTTP request — the
  // server stops work and no ai_usage row is billed for a scan nobody sees.
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Revoke the previous object URL whenever it is replaced, cleared, or the
  // page unmounts.
  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      retryAbortRef.current?.abort();
    },
    [],
  );

  const pickFile = async (file: File | undefined) => {
    setScanError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setScanError({ reason: null, message: t("flow.notImage") });
      return;
    }
    // Show the shot immediately from the original file, before any resize
    // work. The user should never stare at a blank screen after shooting.
    setPhotoUrl(URL.createObjectURL(file));
    setPhase("preparing");
    const run = ++runRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const image = await fileToImageBase64(file);
      if (runRef.current !== run) return;
      setLiveRows([]);
      setPhase("analyzing");
      // Prev* come from the previous scan of this session: its render and
      // crop finished after its own request had already been logged.
      const { prevRoundTripMs, prevRenderMs, prevCropMs, prevFirstNameMs, prevFirstItemMs } =
        sessionTiming;
      sessionTiming = {};
      const requestAt = performance.now();
      const request = {
        imageBase64: image.base64,
        mimeType: image.mimeType,
        crops: true,
        clientTiming: {
          resizeMs: image.resizeMs,
          encodeMs: image.encodeMs,
          payloadKb: Math.round(image.blob.size / 1024),
          prevRoundTripMs,
          prevRenderMs,
          prevCropMs,
          prevFirstNameMs,
          prevFirstItemMs,
        },
      };
      // Names and items show as the model writes them; the plain call covers
      // browsers or networks that cannot read the event stream.
      const scan = await analyzeStreaming({
        open: () => client.ai.analyzeFoodStream(request, { signal: controller.signal }),
        fallback: () => client.ai.analyzeFood(request, { signal: controller.signal }),
        onRows: (rows) => {
          if (runRef.current === run) setLiveRows(rows);
        },
      });
      const result = scan.result;
      sessionTiming.prevRoundTripMs = Math.round(performance.now() - requestAt);
      sessionTiming.prevFirstNameMs = scan.timing.firstNameMs;
      sessionTiming.prevFirstItemMs = scan.timing.firstItemMs;
      if (import.meta.env.DEV) {
        console.debug("[scan] timing", {
          resizeMs: image.resizeMs,
          encodeMs: image.encodeMs,
          payloadKb: request.clientTiming.payloadKb,
          streamed: scan.streamed,
          ...scan.timing,
        });
      }
      if (runRef.current !== run) return;
      setImage(image);
      applyItems(result.items);
      setQuotaReached(result.quotaReached);
      setTooMany(result.tooMany);
      setPlateNote({ plate: result.plate, card: result.card });
      setPhotoId(result.photoId ?? null);
      setMemoryChips(result.memoryChips ?? []);
      setCorrectionsLeft(null);
      setRetriesLeft(result.retriesLeft ?? 0);
      setRetryHint("");
      setRetryError(null);
      setModel(result.model ?? null);
      setAskFeedback(result.askFeedback ?? false);
      setFeedbackAnswered(false);
      setFeedbackRating(null);
      setFeedbackReasons([]);
      setFeedbackNote("");
      setFeedbackKeepPhoto(false);
      setRetryCount(0);
      // Prefill the price form from the last time this plate was bought.
      const defaultName = result.items[0]?.name ?? "";
      setPlateName(defaultName);
      setPlatePlace("");
      setPlatePrice("");
      if (defaultName) {
        client.plate
          .lastPrice({ name: defaultName })
          .then((hit) => {
            if (runRef.current !== run || !hit) return;
            setPlateName(hit.name);
            setPlatePlace(hit.place ?? "");
            setPlatePrice(String(hit.priceIdr));
          })
          .catch(() => {});
      }
      setPhase("confirm");
      // Numbers are on screen after the next two frames; record how long the
      // state commit took, then cut the per-item tiles in the background.
      const respondedAt = performance.now();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          sessionTiming.prevRenderMs = Math.round(performance.now() - respondedAt);
        }),
      );
      cutCrops(
        image.blob,
        result.items.map((item) => item.box),
        run,
        (cropMs) => {
          sessionTiming.prevCropMs = cropMs;
        },
      );
      if (result.photoId) {
        cutStickers(
          result.photoId,
          result.items,
          result.items.map(() => null),
        );
      }
    } catch (err) {
      // Aborted runs bump runRef before aborting, so this only reports real
      // failures of the current run.
      if (runRef.current !== run) return;
      // Scan rejected because the free quota ran out: the paywall explains
      // itself better than an error line.
      if (isPaywallError(err)) {
        navigate({ to: "/pro", search: { from: "quota", next: "/makan/ai" } });
        return;
      }
      setScanError(failureOf(err, t("flow.analyzeFailed")));
      setPhase("idle");
    }
  };

  // Cuts the per-item tiles after the first paint. `run` guards against a
  // newer shot or Foto ulang landing first.
  // Real cutouts (ai.scanSticker): fire one call per boxed item without a
  // sticker yet. The server answers with a quick sticker (a crop of the
  // whole-photo cutout) almost at once; a second call then waits for the
  // refined per-box cutout, which fades in over it. `reuse` carries the ids
  // that are still valid (same box after Hitung ulang).
  const cutStickers = (
    photoId: string,
    list: AiFoodItem[],
    reuse: Array<string | null>,
  ) => {
    const run = ++stickerRunRef.current;
    setStickers(reuse);
    const apply = (index: number, scanId: string) => {
      if (stickerRunRef.current !== run) return;
      setStickers((prev) => prev.map((current, i) => (i === index ? scanId : current)));
    };
    list.forEach((item, index) => {
      if (!item.box || reuse[index]) return;
      const box = [...item.box];
      client.ai
        .scanSticker({ photoId, box })
        .then(async ({ scanId, final }) => {
          if (scanId) apply(index, scanId);
          if (final || !scanId) return;
          const refined = await client.ai.scanSticker({ photoId, box, refine: true });
          if (refined.scanId && refined.scanId !== scanId) apply(index, refined.scanId);
        })
        .catch(() => {});
    });
  };

  const cutCrops = (
    blob: Blob,
    boxes: Array<ItemBox | undefined | null>,
    run: number,
    onDone?: (cropMs: number) => void,
  ) => {
    const startedAt = performance.now();
    setCrops(boxes.map(() => null));
    setCropping(true);
    const url = URL.createObjectURL(blob);
    void cropItems(url, boxes)
      .catch(() => boxes.map(() => null))
      .then((cut) => {
        URL.revokeObjectURL(url);
        if (runRef.current !== run) return;
        setCrops(cut);
        setCropping(false);
        onDone?.(Math.round(performance.now() - startedAt));
      });
  };

  const reset = () => {
    runRef.current += 1;
    abortRef.current?.abort();
    retryAbortRef.current?.abort();
    setPhase("idle");
    setLiveRows([]);
    applyItems([]);
    setImage(null);
    setCrops([]);
    stickerRunRef.current += 1;
    setStickers([]);
    setCropping(false);
    setQuotaReached(false);
    setPhotoUrl(null);
    setPlateName("");
    setPlatePlace("");
    setPlatePrice("");
    setEatenAt(null);
    setScanError(null);
    setTooMany(false);
    setPlateNote(null);
    setPhotoId(null);
    setCorrectionsLeft(null);
    setRetriesLeft(0);
    setMemoryChips([]);
    setRetryHint("");
    setRetryError(null);
    setAskFeedback(false);
    setFeedbackAnswered(false);
    setFeedbackRating(null);
    setFeedbackReasons([]);
    setFeedbackNote("");
    setFeedbackKeepPhoto(false);
    setRetryCount(0);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (galleryInputRef.current) galleryInputRef.current.value = "";
  };

  // Fire-and-forget: feedback failures must never block the scan flow.
  const sendFeedback = (
    rating: "akurat" | "kurang_akurat" | "salah" | "dilewati",
    reasons?: FeedbackReason[],
    note?: string,
    keepPhoto?: boolean,
  ) => {
    if (!photoId) return;
    void client.ai
      .saveScanFeedback({
        photoId,
        rating,
        source: "web",
        ...(reasons?.length ? { reasons } : {}),
        ...(note?.trim() ? { note: note.trim() } : {}),
        ...(model ? { model } : {}),
        afterRetry: retryCount > 0,
        ...(keepPhoto && (rating === "kurang_akurat" || rating === "salah")
          ? { keepPhoto: true }
          : {}),
      })
      .catch(() => {});
  };

  // Hitung ulang: same photo, one more model pass. Only the id travels (the
  // photo stays server-side) and no daily scan is spent. The previous result
  // stays visible until the new items land; on failure it stays for good.
  const retryAnalysis = async () => {
    if (!image || !photoId || retrying || retriesLeft <= 0) return;
    setRetryError(null);
    setRetrying(true);
    const controller = new AbortController();
    retryAbortRef.current = controller;
    try {
      const result = await client.ai.analyzeFoodRetry(
        { photoId, hint: retryHint.trim() || undefined },
        { signal: controller.signal },
      );
      applyItems(result.items);
      cutCrops(
        image.blob,
        result.items.map((item) => item.box),
        runRef.current,
      );
      // Only items whose box moved get a fresh cutout; same box, same sticker.
      cutStickers(
        photoId,
        result.items,
        result.items.map((next) => {
          const prevIndex = items.findIndex((prev) => sameBox(prev.box, next.box));
          return prevIndex === -1 ? null : (stickers[prevIndex] ?? null);
        }),
      );
      setRetriesLeft(result.retriesLeft);
      setMemoryChips(result.memoryChips ?? []);
      setRetryHint("");
      setModel(result.model ?? model);
      setRetryCount((count) => count + 1);
      setTooMany(result.tooMany);
      setPlateNote({ plate: result.plate, card: result.card });
    } catch (err) {
      setRetryError(failureOf(err, t("flow.retryFailed")));
    } finally {
      if (retryAbortRef.current === controller) retryAbortRef.current = null;
      setRetrying(false);
    }
  };

  const saveAll = async () => {
    if (!image) return;
    const values = items.map((item, index) => parseNum(kcals[index] ?? String(item.kcal)));
    const invalid = values.findIndex((kcal) => kcal === null || kcal < 0);
    if (invalid !== -1) {
      toast.error(t("flow.kcalInvalid", { name: items[invalid]?.name ?? "" }));
      return;
    }
    setSaving(true);
    const priceNum = parseIdrInput(platePrice);
    if (platePrice.trim() !== "" && priceNum === null) {
      toast.error(t("flow.priceInvalid"));
      setSaving(false);
      return;
    }
    const plate = {
      name: plateName.trim() || undefined,
      place: platePlace.trim() || undefined,
      // Coordinates ride along only with a place name and only when opted in.
      ...(platePlace.trim() && placeLocation.enabled && placeLocation.coords
        ? placeLocation.coords
        : {}),
      ...(priceNum != null ? { priceIdr: Math.round(priceNum) } : {}),
    };
    try {
      // One call: photo stored once, one row and one sticker per item.
      const saved = await client.food.addScan({
        date: scanDate,
        meal,
        imageBase64: image.base64,
        mimeType: image.mimeType,
        itemsJson: JSON.stringify(withoutScaleRead(withoutPortionPrior(baseList))),
        ...(photoId ? { scanPhotoId: photoId } : {}),
        ...(plate.name || plate.place || plate.priceIdr != null ? { plate } : {}),
        ...(eatenAt !== null
          ? { eatenAt: eatenAtFromClock(scanDate ?? jakartaToday(), eatenAtClock(eatenAt)) ?? undefined }
          : {}),
        items: items.map((item, index) => ({
          name: item.name,
          kcal: values[index]!,
          grams: item.grams,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          fiber: item.fiber,
          box: item.box,
          // Already-cut stickers are promoted on save; unfinished ones are
          // cut by the server in the background.
          ...(stickers[index] ? { scanId: stickers[index] } : {}),
        })),
      });
      // Miss log: AI estimate vs what the user kept. Never blocks the save.
      void client.ai
        .logCorrections({
          source: "web",
          items: items.map((item, index) => {
            const base = baseRows[index];
            const model = base ? modelNumbers(base) : undefined;
            return {
              meal,
              dishName: item.name,
              aiKcal: Math.round(model?.kcal ?? item.kcal),
              savedKcal: values[index] ?? 0,
              aiGrams: model?.grams ?? item.grams ?? null,
              aiConfidence: item.confidence ?? null,
            };
          }),
        })
        .catch(() => {});
      toast.success(t("toast.saved", { count: saved.items.length }));
      queryClient.invalidateQueries({ queryKey: orpc.food.key() });
      queryClient.invalidateQueries({ queryKey: orpc.day.key() });
      // The save already landed: results are safe in the diary. Only then
      // offer Founder to the user who just spent their last free scan.
      navigate(
        quotaReached
          ? { to: "/pro", search: { from: "quota", next: "/makan" } }
          : { to: "/makan" },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("flow.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (phase === "preparing" || phase === "analyzing") {
    // Measured pipeline: median ~3 s, worst ~9 s. Copy is staged so the wait
    // reads as progress, not as a frozen spinner.
    const steps = [
      { label: t("analyzing.step.prepared"), done: true },
      { label: t("analyzing.step.reading"), done: phase === "analyzing" },
      { label: t("analyzing.step.tidying"), done: false },
    ];
    return (
      <Page className="md:max-w-3xl" role="status">
        <PageHeader
          className="pb-3"
          title={t("analyzing.title")}
          subtitle={t("analyzing.subtitle")}
        />
        <Card className="overflow-hidden p-0">
          <div className="relative">
            {photoUrl && (
              <img
                src={photoUrl}
                alt={t("analyzing.photoAlt")}
                className="max-h-[26rem] w-full object-cover"
              />
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-5 pt-16 pb-5">
              <ul className="space-y-2">
                {steps.map((step) => (
                  <li
                    key={step.label}
                    className={cn(
                      "flex items-center gap-2.5 text-sm font-semibold",
                      step.done ? "text-white" : "text-white/60",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border-2",
                        step.done
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-white/50",
                      )}
                    >
                      {step.done && <Check className="size-3.5" strokeWidth={3} />}
                    </span>
                    {step.label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
        {phase === "analyzing" && <LiveRows rows={liveRows} />}
        {fact && !maternalInfo && !gain && (
          <div className="mt-3 rounded-2xl bg-card p-4 text-sm">
            <span className="font-bold">{t("fact.title")} </span>
            <span className="text-muted-foreground">
              {t("fact.line", { text: fact.text, kcal: fmtInt(fact.kcal), move: fact.move })}
            </span>
          </div>
        )}
        <Button variant="secondary" className="mt-4 w-full" onClick={reset}>
          {t("analyzing.cancel")}
        </Button>
      </Page>
    );
  }

  if (phase === "confirm") {
    const reactionText = totalKcal > 0 ? t(`reaction.${reactionKey(totalKcal)}`) : null;
    const showCrops = cropping || crops.some(Boolean) || stickers.some(Boolean);
    return (
      <Page className="stagger-enter md:max-w-3xl">
        <PageHeader
          className="pb-3"
          title={t("result.title")}
          action={
            <Button variant="ghost" size="sm" onClick={reset}>
              {t("result.retake")}
            </Button>
          }
        />

        {tooMany && (
          <Card className="mb-3 p-4" role="status">
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-makan-soft">
                <TriangleAlert className="size-4 text-makan-ink" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[0.9375rem] font-bold">{t("fail.reason.too_many.title")}</p>
                <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                  {t("fail.tooManyPartial")}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setTooMany(false)}>
                {t("result.keep", { count: items.length })}
              </Button>
              <Button variant="secondary" size="sm" onClick={reset}>
                {t("result.retake")}
              </Button>
            </div>
          </Card>
        )}

        <Card className="px-4 py-4 text-center">
          <p className="text-sm font-semibold text-muted-foreground">{t("result.total")}</p>
          <p className="mt-1 text-[3rem] leading-none font-extrabold tracking-tighter tabular-nums">
            <CountUp value={totalKcal} duration={700} />
            <span className="ml-1.5 text-base font-semibold tracking-normal text-muted-foreground">
              kcal
            </span>
          </p>
          {reactionText && (
            <>
              <p className="mt-2 flex items-center justify-center gap-1.5 text-base font-bold text-primary">
                {totalKcal > 550 ? (
                  <TriangleAlert className="size-5" aria-hidden />
                ) : (
                  <ThumbsUp className="size-5" aria-hidden />
                )}
                {reactionText}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                <Drumstick
                  strokeWidth={1.5}
                  className="mr-1 inline size-4 align-text-bottom"
                  aria-hidden
                />
                {t("result.geprek", { count: Math.round(totalKcal / GEPREK_KCAL) })}
              </p>
            </>
          )}
          {items.length > 0 && (
            <ShareStoryButton
              variant="secondary"
              className="mt-3 w-full md:w-auto"
              story={{
                kind: "meal",
                name:
                  items.length > 1
                    ? t("result.names.more", { first: items[0]!.name, count: items.length - 1 })
                    : items[0]!.name,
                kcal: totalKcal,
                protein: items.reduce((sum, item) => sum + (item.protein ?? 0), 0),
                carbs: items.reduce((sum, item) => sum + (item.carbs ?? 0), 0),
                fat: items.reduce((sum, item) => sum + (item.fat ?? 0), 0),
                reaction: reactionText ?? undefined,
                photoSrc: photoUrl,
              }}
            />
          )}
        </Card>
        <PlateNote note={plateNote} />

        {askFeedback && !feedbackAnswered && photoId && (
          <Card className="mt-3 px-4 py-3" role="form" aria-label={t("feedback.aria")}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <p className="mr-auto text-sm font-bold">{t("feedback.title")}</p>
              {feedbackRating === null && (
                <>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      sendFeedback("akurat");
                      setFeedbackAnswered(true);
                    }}
                  >
                    {t("feedback.accurate")}
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => setFeedbackRating("kurang_akurat")}
                  >
                    {t("feedback.lessAccurate")}
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => setFeedbackRating("salah")}>
                    {t("feedback.wrong")}
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("feedback.skip")}
                onClick={() => {
                  sendFeedback("dilewati");
                  setFeedbackAnswered(true);
                }}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
            {feedbackRating !== null && (
              <div className="mt-3 space-y-3">
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-label={t("feedback.reasonsLabel")}
                >
                  {FEEDBACK_REASONS.map((key) => {
                    const active = feedbackReasons.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          setFeedbackReasons((current) =>
                            current.includes(key)
                              ? current.filter((reason) => reason !== key)
                              : [...current, key],
                          )
                        }
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                          active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {t(`feedback.reason.${key}`)}
                      </button>
                    );
                  })}
                </div>
                <Input
                  aria-label={t("feedback.noteAria")}
                  value={feedbackNote}
                  maxLength={300}
                  onChange={(event) => setFeedbackNote(event.target.value)}
                  placeholder={t("feedback.notePlaceholder")}
                  autoComplete="off"
                />
                <label className="flex cursor-pointer items-start gap-2.5">
                  <Checkbox
                    className="mt-0.5"
                    checked={feedbackKeepPhoto}
                    onCheckedChange={(checked) => setFeedbackKeepPhoto(checked === true)}
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold">
                      {t("feedback.keepPhoto.label")}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t("feedback.keepPhoto.hint")}
                    </span>
                  </span>
                </label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      sendFeedback(feedbackRating, feedbackReasons, feedbackNote, feedbackKeepPhoto);
                      setFeedbackAnswered(true);
                    }}
                  >
                    {t("feedback.send")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setFeedbackRating(null)}>
                    {t("common:actions.back")}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}

        <section className="mt-4" aria-label={t("result.items.label")}>
          <SectionTitle
            className="mb-2"
            action={
              <span className="text-xs font-semibold text-muted-foreground">
                {t("result.items.editable")}
              </span>
            }
          >
            {t("result.items.title")}
          </SectionTitle>
          <ListGroup>
            {items.map((item, index) => (
              <li
                key={`${item.name}-${index}`}
                className={cn(
                  "relative flex min-h-12 items-center gap-2.5 px-4 py-2",
                  changed[index] && CORRECTED_ROW_CLASS,
                )}
              >
                {crops[index] || stickers[index] ? (
                  <CutoutImage
                    crop={crops[index]}
                    sticker={stickers[index]}
                    name=""
                    className="chip-pop size-10 shrink-0 rounded-xl motion-reduce:animate-none"
                  />
                ) : cropping && item.box ? (
                  <Skeleton className="size-10 shrink-0 rounded-xl" aria-hidden />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-[0.9375rem] font-semibold">
                      {item.name}
                    </span>
                    {changed[index] && <CorrectBadge kind={changed[index]} />}
                  </span>
                  <span className="block truncate text-[0.8125rem] text-muted-foreground">
                    {[
                      item.portion,
                      item.grams != null ? `± ${fmtGramsLabel(item.grams)}` : null,
                      item.confidence != null
                        ? t("result.items.confidence", {
                            percent: fmtPercent(Math.round(item.confidence * 100)),
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <MacroLine
                      compact
                      protein={item.protein}
                      carbs={item.carbs}
                      fat={item.fat}
                      fiber={item.fiber}
                      className="text-xs text-muted-foreground tabular-nums"
                    />
                    <KindCycleChip
                      value={kinds[index] ?? item.kind}
                      onChange={(next) => {
                        touchList();
                        setKinds((current) => ({ ...current, [index]: next }));
                      }}
                    />
                  </span>
                  {item.cup && <CupChoices choice={item.cup} onPick={(next) => pickCup(index, next)} />}
                  {item.portionPrior && (
                    <PortionPriorChips name={item.name} item={item} onSwap={() => swapPrior(index)} />
                  )}
                  {item.scaleRead && (
                    <ScaleReadChips name={item.name} item={item} onSwap={() => swapScale(index)} />
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Input
                    aria-label={t("result.items.kcalAria", { name: item.name })}
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={kcals[index] ?? String(item.kcal)}
                    onChange={(event) => {
                      touchList();
                      setKcals((current) => ({ ...current, [index]: event.target.value }));
                    }}
                    className="h-10 w-20 text-right font-bold tabular-nums"
                  />
                  <span className="text-xs font-semibold text-muted-foreground">kcal</span>
                </span>
              </li>
            ))}
          </ListGroup>
        </section>

        {!retrying && !saving && memoryChips.length > 0 && items.length > 0 && (
          <MemoryChips
            names={memoryChips}
            photoId={photoId}
            items={items}
            kcals={kcals}
            kinds={kinds}
            onApply={applyCorrection}
          />
        )}

        {!retrying && !saving && items.length > 0 && (
          <CorrectBox
            photoId={photoId}
            items={items}
            kcals={kcals}
            kinds={kinds}
            correctionsLeft={correctionsLeft}
            notice={correctionNote}
            canUndo={undoStack.length > 0}
            onUndo={undoCorrection}
            onApply={applyCorrection}
          />
        )}

        {photoId && (
          <section className="mt-4" aria-label={t("retry.title")}>
            <SectionTitle
              className="mb-2"
              action={
                <span className="text-xs font-semibold text-muted-foreground">
                  {retriesLeft > 0 ? t("retry.left", { count: retriesLeft }) : t("retry.exhausted")}
                </span>
              }
            >
              {t("retry.title")}
            </SectionTitle>
            <Card className="space-y-2 px-4 py-3">
              {retriesLeft > 0 ? (
                <div className="flex items-center gap-2">
                  <Input
                    id="retry-hint"
                    aria-label={t("retry.hintLabel")}
                    value={retryHint}
                    maxLength={200}
                    onChange={(event) => setRetryHint(event.target.value)}
                    placeholder={t("retry.hintPlaceholder")}
                    autoComplete="off"
                    className="min-w-0 flex-1"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void retryAnalysis()}
                    disabled={retrying}
                  >
                    {retrying ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        {t("retry.running")}
                      </>
                    ) : (
                      <>
                        <RefreshCw className="size-4" aria-hidden />
                        {t("retry.action")}
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <p className="text-sm font-semibold text-muted-foreground">
                  {t("retry.exhaustedHint")}
                </p>
              )}
              {retrying && (
                <p className="text-sm text-muted-foreground animate-pulse" role="status">
                  {t("retry.keepPrevious")}
                </p>
              )}
              {retryError && (
                <p className="text-sm font-semibold text-destructive" role="alert">
                  {t("retry.failedKept", {
                    message: retryError.reason
                      ? t(`fail.reason.${retryError.reason}.message`)
                      : retryError.message,
                  })}
                </p>
              )}
            </Card>
          </section>
        )}

        <Segmented
          className="mt-4"
          label={t("result.meal.label")}
          value={meal}
          onChange={(value) => {
            mealPickedRef.current = true;
            setMeal(value);
          }}
          options={MEALS.map(([key, mealLabel]) => ({ value: key, label: mealLabel }))}
        />

        <SnackAdviceCard
          className="mt-3"
          state={advice}
          onHalf={halve}
          halfApplied={fullItems !== null}
          onUndoHalf={undoHalf}
        />

        <FoodSafetyNotes
          className="mt-3"
          names={items.map((item) => item.name)}
          date={scanDate}
          addToDay
        />

        <section className="mt-4" aria-label={t("plate.section")}>
          <Card className="space-y-2 px-4 py-3">
            <div className="flex items-end gap-3">
              <div className="w-32 shrink-0">
                <FieldLabel htmlFor="plate-price">{t("plate.price")}</FieldLabel>
                <IdrInput
                  id="plate-price"
                  value={platePrice}
                  onChange={setPlatePrice}
                  placeholder={t("plate.pricePlaceholder", { example: fmtInt(28000) })}
                />
              </div>
              <div className="min-w-0 flex-1">
                <FieldLabel htmlFor="plate-name">{t("makan:plate.edit.name")}</FieldLabel>
                <Input
                  id="plate-name"
                  value={plateName}
                  onChange={(event) => setPlateName(event.target.value)}
                  placeholder={t("makan:plate.edit.namePlaceholder")}
                  autoComplete="off"
                />
              </div>
            </div>
            <div>
              <FieldLabel htmlFor="plate-place">{t("makan:plate.edit.place")}</FieldLabel>
              <Input
                id="plate-place"
                value={platePlace}
                onChange={(event) => setPlatePlace(event.target.value)}
                placeholder={t("makan:plate.edit.placePlaceholder")}
                autoComplete="off"
              />
            </div>
            <SaveLocationToggle
              enabled={placeLocation.enabled}
              status={placeLocation.status}
              onChange={placeLocation.setEnabled}
            />
          </Card>
        </section>

        <div className="mt-4">
          <EatenAtField id="scan-eaten-at" date={scanDate ?? jakartaToday()} value={eatenAt} onChange={setEatenAt} />
        </div>

        <div className="mt-4 space-y-2">
          {photoUrl && (
            <Disclosure title={t("result.photoToggle")}>
              <figure className="text-center">
                <img
                  src={photoUrl}
                  alt={t("result.photoAlt")}
                  className="mx-auto max-h-72 max-w-full rounded-2xl object-contain"
                />
                <figcaption className="sr-only">{t("result.photoCaption")}</figcaption>
              </figure>
              {showCrops && (
                <ul
                  className="flex flex-wrap justify-center gap-3 pt-2"
                  aria-label={t("result.cropsLabel")}
                  aria-busy={cropping}
                >
                  {items.map((item, index) =>
                    crops[index] || stickers[index] ? (
                      <li
                        key={`${item.name}-${index}`}
                        className="chip-pop flex w-24 flex-col items-center gap-1 motion-reduce:animate-none"
                        style={{ animationDelay: `${index * 70}ms` }}
                      >
                        <CutoutImage
                          crop={crops[index]}
                          sticker={stickers[index]}
                          name={item.name}
                          className="size-20 rounded-2xl"
                        />
                        <span className="w-full truncate text-center text-xs font-semibold text-foreground">
                          {item.name}
                        </span>
                      </li>
                    ) : cropping && item.box ? (
                      <li
                        key={`${item.name}-${index}`}
                        className="flex w-24 flex-col items-center gap-1"
                        aria-hidden
                      >
                        <Skeleton className="size-20 rounded-2xl" />
                        <span className="w-full truncate text-center text-xs font-semibold text-foreground">
                          {item.name}
                        </span>
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
            </Disclosure>
          )}
          {photoId && (
            <Disclosure title={t("result.info.title")}>
              <p>{t("result.info.retry")}</p>
              {askFeedback && !feedbackAnswered && <p>{t("result.info.feedback")}</p>}
            </Disclosure>
          )}
        </div>

        {/* Mobile: the primary pill floats above the tab bar; desktop: inline. */}
        <div
          style={{ animation: "none" }}
          className="fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-30 px-4 md:static md:mt-6 md:px-0"
        >
          <div className="mx-auto flex max-w-[41rem] items-center gap-2 md:max-w-none">
            <Button
              size="lg"
              className="w-full shadow-float md:w-auto"
              onClick={() => void saveAll()}
              disabled={saving || retrying}
            >
              {saving
                ? t("result.save.saving")
                : t("result.save.toMeal", { meal: MEAL_LABELS[meal] })}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={reset}
              disabled={saving || retrying}
              className="hidden md:inline-flex"
            >
              {t("common:actions.cancel")}
            </Button>
          </div>
        </div>
        {/* Clearance so the floating pill never covers the last row. */}
        <div aria-hidden className="h-24 md:hidden" />
      </Page>
    );
  }

  return (
    <Page className="md:max-w-3xl">
      <PageHeader
        className="pb-3"
        title={t("idle.title")}
        action={
          <Link to="/makan">
            <Button variant="ghost" size="sm">
              {t("common:actions.back")}
            </Button>
          </Link>
        }
      />

      {scanError && (
        <Card role="alert" className="mb-3 p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <TriangleAlert className="size-4 text-destructive" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-bold">
                {t(`fail.reason.${scanError.reason ?? "failed"}.title`)}
              </p>
              <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                {scanError.reason
                  ? t(`fail.reason.${scanError.reason}.message`)
                  : scanError.message}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => cameraInputRef.current?.click()}>
              {t("result.retake")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => galleryInputRef.current?.click()}>
              {t("idle.gallery")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setScanError(null)}>
              {t("common:actions.close")}
            </Button>
          </div>
        </Card>
      )}

      <Card className="flex flex-col items-center px-5 py-6 text-center">
        <span
          className="flex size-16 items-center justify-center rounded-full bg-makan-soft"
          aria-hidden
        >
          <Camera className="size-7 text-makan-ink" />
        </span>
        <h2 className="mt-3 text-xl font-bold tracking-tight">{t("idle.heading")}</h2>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-makan-soft px-3.5 py-1.5 text-sm font-semibold text-makan-ink">
          <Lightbulb className="size-4 shrink-0" aria-hidden />
          {t("idle.tip")}
        </p>
        <ReferenceHint />
        <div className="mt-5 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <label className={cn(buttonVariants(), "w-full cursor-pointer sm:w-auto")}>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Reset so picking the SAME file again still fires change.
                event.target.value = "";
                void pickFile(file);
              }}
            />
            <Camera className="size-4" aria-hidden />
            {t("idle.camera")}
          </label>
          <label
            className={cn(
              buttonVariants({ variant: "secondary" }),
              "w-full cursor-pointer sm:w-auto",
            )}
          >
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Reset so picking the SAME file again still fires change.
                event.target.value = "";
                void pickFile(file);
              }}
            />
            <Images className="size-4" aria-hidden />
            {t("idle.gallery")}
          </label>
        </div>
      </Card>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Link
          to="/makan"
          search={{ cerita: true }}
          className="flex min-h-12 items-center justify-between gap-2 rounded-3xl bg-card px-4 py-2 text-sm font-bold transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          {t("idle.story")}
          <Mic className="size-5 shrink-0 text-primary" aria-hidden />
        </Link>
        <Link
          to="/makan/barcode"
          search={scanDate ? { date: scanDate } : {}}
          className="flex min-h-12 items-center justify-between gap-2 rounded-3xl bg-card px-4 py-2 text-sm font-bold transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          {t("idle.barcode")}
          <ScanBarcode className="size-5 shrink-0 text-primary" aria-hidden />
        </Link>
      </div>

      <Disclosure title={t("idle.info.title")} className="mt-3">
        <p>{t("idle.info.how")}</p>
        <p>{t("idle.info.story")}</p>
        <p>{t("idle.info.barcode")}</p>
        <p className="flex items-center gap-1.5 text-xs">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          {profile.data?.profile?.keepPhotos ? t("privacy.kept") : t("privacy.notKept")}
        </p>
      </Disclosure>
    </Page>
  );
}
