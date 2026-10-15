import {
  Camera,
  Check,
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
import { toast } from "sonner";

import {
  MEAL_LABELS,
  effectiveRamadan,
  slotsFor,
  suggestMealForDish,
  suggestMealNow,
} from "@joyorogo/api/lib/engine";
import { isHeavyDish } from "@joyorogo/api/lib/food-kind";
import { randomFact } from "@joyorogo/api/lib/facts";
import { SCAN_FAIL_COPY, TOO_MANY_PARTIAL_MESSAGE, scanFailReason } from "@joyorogo/api/lib/scan-errors";
import type { ScanFailReason } from "@joyorogo/api/lib/scan-errors";
import { parseIdrInput } from "@joyorogo/api/lib/format";
import type { Meal } from "@joyorogo/api/lib/engine";
import { scalePortion } from "@joyorogo/api/lib/portion";
import { dominantKind } from "@joyorogo/api/lib/snack-advice";
import type { FoodKind } from "@joyorogo/api/lib/food-kind";
import { Button, buttonVariants } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import {
  Card,
  FieldLabel,
  ListGroup,
  Page,
  PageHeader,
  SectionTitle,
  Segmented,
} from "@/components/kit/surface";
import { IdrInput } from "@/components/plate/idr-input";
import { SaveLocationToggle } from "@/components/places/location-toggle";
import { STICKER_FILTER, stickerUrl } from "@/components/sticker";
import { ShareStoryButton } from "@/components/story/share-story-button";
import { cropItems } from "@/lib/crop";
import type { ItemBox } from "@/lib/crop";
import type { AiFoodItem } from "@/lib/api-types";
import { KindCycleChip, SnackAdviceCard, useSnackAdvice } from "@/components/makan/snack-advice";
import { isPaywallError } from "@/lib/billing";
import { fmtInt, parseNum } from "@/lib/format";
import { usePlaceLocation } from "@/lib/location";
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
const FEEDBACK_REASONS = [
  ["porsi", "Porsi salah"],
  ["makanan", "Makanan salah"],
  ["kcal_tinggi", "Kalori kelewat tinggi"],
  ["kcal_rendah", "Kalori kelewat rendah"],
] as const;

type FeedbackReason = (typeof FEEDBACK_REASONS)[number][0];

/** The signature reaction line — the gimmick people screenshot. */
function reaction(totalKcal: number): string {
  if (totalKcal > 1100) return "BUSSET, yakin makan segitu bro??";
  if (totalKcal > 550) return "Buset, yakin makan segitu bro??";
  return "Aman, bro";
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
let sessionTiming: { prevRoundTripMs?: number; prevRenderMs?: number; prevCropMs?: number } = {};

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
    throw new Error("Browser ini tidak mendukung pengolahan gambar.");
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
  if (!jpeg) throw new Error("Gagal memproses foto. Coba lagi.");
  const base64 = await blobToBase64(jpeg);
  const encodeMs = Math.round(performance.now() - startedAt) - resizeMs;
  return { base64, mimeType: "image/jpeg", blob: jpeg, resizeMs, encodeMs };
}

function sameBox(a: AiFoodItem["box"], b: AiFoodItem["box"]) {
  return !!a && !!b && a.length === b.length && a.every((value, i) => value === b[i]);
}

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The day the scan belongs to, forwarded from the makan page's DaySwitcher.
  const { date: scanDate } = Route.useSearch();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "preparing" | "analyzing" | "confirm">("idle");
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
  const [error, setError] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<ScanFailReason | null>(null);
  // The photo held more food than fit: the result keeps the most prominent
  // items and shows guidance until the user keeps them or reshoots.
  const [tooMany, setTooMany] = useState(false);
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
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryAbortRef = useRef<AbortController | null>(null);
  // "Hasilnya akurat?" — shown when the server asks (every scan for the
  // first 3, then once per WIB day). Never blocks saving; answering or
  // dismissing hides the card, and a "Hitung ulang" tap logs kurang_akurat.
  const [model, setModel] = useState<string | null>(null);
  const [askFeedback, setAskFeedback] = useState(false);
  const [feedbackAnswered, setFeedbackAnswered] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState<"kurang_akurat" | "salah" | null>(null);
  const [feedbackReasons, setFeedbackReasons] = useState<FeedbackReason[]>([]);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  // Price attaches to the whole plate, not per item: one number per photo.
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
  const [fullPortion, setFullPortion] = useState<{
    items: AiFoodItem[];
    kcals: Record<number, string>;
  } | null>(null);
  const fullItems = fullPortion?.items ?? null;
  // What the AI said, for the stored breakdown and the miss log.
  const aiItems = fullItems ?? items;
  const advice = useSnackAdvice({
    date: scanDate,
    kcal: totalKcal,
    kind: dominantKind(items.map((item, index) => kinds[index] ?? item.kind)),
    slot: meal,
    name:
      items.length > 1
        ? `${items[0]!.name} dan ${items.length - 1} lainnya`
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
        kcal: half.kcal,
        grams: half.grams ?? undefined,
        protein: half.protein ?? undefined,
        carbs: half.carbs ?? undefined,
        fat: half.fat ?? undefined,
        fiber: half.fiber ?? undefined,
      };
    });
    setFullPortion({ items, kcals });
    setItems(scaled);
    setKcals(Object.fromEntries(scaled.map((item, index) => [index, String(item.kcal)])));
  };

  const undoHalf = () => {
    if (!fullPortion) return;
    setItems(fullPortion.items);
    setKcals(fullPortion.kcals);
    setFullPortion(null);
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
    setError(null);
    setErrorReason(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("File itu bukan gambar. Pilih foto makanan (JPG/PNG/WebP).");
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
      setPhase("analyzing");
      // Prev* come from the previous scan of this session: its render and
      // crop finished after its own request had already been logged.
      const { prevRoundTripMs, prevRenderMs, prevCropMs } = sessionTiming;
      sessionTiming = {};
      const requestAt = performance.now();
      const result = await client.ai.analyzeFood(
        {
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
          },
        },
        { signal: controller.signal },
      );
      sessionTiming.prevRoundTripMs = Math.round(performance.now() - requestAt);
      if (runRef.current !== run) return;
      setImage(image);
      applyItems(result.items);
      setQuotaReached(result.quotaReached);
      setTooMany(result.tooMany);
      setPhotoId(result.photoId ?? null);
      setRetriesLeft(result.retriesLeft ?? 0);
      setRetryHint("");
      setRetryError(null);
      setModel(result.model ?? null);
      setAskFeedback(result.askFeedback ?? false);
      setFeedbackAnswered(false);
      setFeedbackRating(null);
      setFeedbackReasons([]);
      setFeedbackNote("");
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
        navigate({ to: "/founder", search: { from: "quota", next: "/makan/ai" } });
        return;
      }
      setError(err instanceof Error ? err.message : "Gagal menganalisis foto. Coba lagi.");
      setErrorReason(scanFailReason(err));
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
    setError(null);
    setErrorReason(null);
    setTooMany(false);
    setPhotoId(null);
    setRetriesLeft(0);
    setRetryHint("");
    setRetryError(null);
    setAskFeedback(false);
    setFeedbackAnswered(false);
    setFeedbackRating(null);
    setFeedbackReasons([]);
    setFeedbackNote("");
    setRetryCount(0);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (galleryInputRef.current) galleryInputRef.current.value = "";
  };

  // Fire-and-forget: feedback failures must never block the scan flow.
  const sendFeedback = (
    rating: "akurat" | "kurang_akurat" | "salah" | "dilewati",
    reasons?: FeedbackReason[],
    note?: string,
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
      })
      .catch(() => {});
  };

  // Hitung ulang: same photo, one more model pass. Only the id travels (the
  // photo stays server-side) and no daily scan is spent. The previous result
  // stays visible until the new items land; on failure it stays for good.
  const retryAnalysis = async () => {
    if (!image || !photoId || retrying || retriesLeft <= 0) return;
    // The tap itself is an implicit "kurang akurat" verdict on this result.
    if (askFeedback && !feedbackAnswered) {
      sendFeedback("kurang_akurat");
      setFeedbackAnswered(true);
    }
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
      setRetryHint("");
      setModel(result.model ?? model);
      setRetryCount((count) => count + 1);
      setTooMany(result.tooMany);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Gagal menghitung ulang. Coba lagi.");
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
      toast.error(`Kalori untuk "${items[invalid]?.name}" belum valid.`);
      return;
    }
    setSaving(true);
    const priceNum = parseIdrInput(platePrice);
    if (platePrice.trim() !== "" && priceNum === null) {
      toast.error("Harga sepiring belum valid (angka rupiah).");
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
        itemsJson: JSON.stringify(aiItems),
        ...(plate.name || plate.place || plate.priceIdr != null ? { plate } : {}),
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
          items: items.map((item, index) => ({
            meal,
            dishName: item.name,
            aiKcal: Math.round(aiItems[index]?.kcal ?? item.kcal),
            savedKcal: values[index] ?? 0,
            aiGrams: aiItems[index]?.grams ?? item.grams ?? null,
            aiConfidence: item.confidence ?? null,
          })),
        })
        .catch(() => {});
      toast.success(`${saved.items.length} makanan dicatat.`);
      queryClient.invalidateQueries({ queryKey: orpc.food.key() });
      queryClient.invalidateQueries({ queryKey: orpc.day.key() });
      // The save already landed: results are safe in the diary. Only then
      // offer Founder to the user who just spent their last free scan.
      navigate(
        quotaReached
          ? { to: "/founder", search: { from: "quota", next: "/makan" } }
          : { to: "/makan" },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan. Coba lagi.");
    } finally {
      setSaving(false);
    }
  };

  if (phase === "preparing" || phase === "analyzing") {
    // Measured pipeline: median ~3 s, worst ~9 s. Copy is staged so the wait
    // reads as progress, not as a frozen spinner.
    const steps = [
      { label: "Foto disiapkan", done: true },
      { label: "AI membaca piring", done: phase === "analyzing" },
      { label: "Porsi & kalori dirapikan", done: false },
    ];
    return (
      <Page className="md:max-w-3xl" role="status">
        <PageHeader title="Menganalisis foto" subtitle="Sebentar ya, biasanya 8 sampai 15 detik." />
        <Card className="overflow-hidden p-0">
          <div className="relative">
            {photoUrl && (
              <img
                src={photoUrl}
                alt="Foto makanan yang sedang dianalisis"
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
        {fact && (
          <div className="mt-3 rounded-2xl bg-card p-4 text-sm">
            <span className="font-bold">Tahukah kamu? </span>
            <span className="text-muted-foreground">
              {fact.text} = {fact.kcal.toLocaleString("id-ID")} kcal, setara {fact.move}
            </span>
          </div>
        )}
        <Button variant="secondary" className="mt-4 w-full" onClick={reset}>
          Batalkan
        </Button>
      </Page>
    );
  }

  if (phase === "confirm") {
    return (
      <Page className="md:max-w-3xl">
        <PageHeader
          title="Cek hasil AI"
          action={
            <Button variant="ghost" size="sm" onClick={reset}>
              Foto ulang
            </Button>
          }
        />

        {photoUrl && (
          <Card className="p-4">
            <figure className="text-center">
              <img
                src={photoUrl}
                alt="Foto asli makananmu"
                className="mx-auto max-h-72 max-w-full rounded-2xl object-contain"
              />
              <figcaption className="sr-only">Foto asli dan potongan tiap makanan</figcaption>
            </figure>
            {(cropping || crops.some(Boolean) || stickers.some(Boolean)) && (
              <ul
                className="mt-4 flex flex-wrap justify-center gap-3"
                aria-label="Potongan tiap makanan"
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
                      <span className="w-full truncate text-center text-xs font-semibold">
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
                      <span className="w-full truncate text-center text-xs font-semibold">
                        {item.name}
                      </span>
                    </li>
                  ) : null,
                )}
              </ul>
            )}
          </Card>
        )}

        {tooMany && (
          <Card className="mt-3" role="status">
            <span className="flex size-9 items-center justify-center rounded-full bg-makan-soft">
              <TriangleAlert className="size-[1.125rem] text-makan-ink" aria-hidden />
            </span>
            <p className="mt-3 text-[0.9375rem] font-bold">{SCAN_FAIL_COPY.too_many.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {TOO_MANY_PARTIAL_MESSAGE}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setTooMany(false)}>
                Pakai {items.length} item ini
              </Button>
              <Button variant="secondary" size="sm" onClick={reset}>
                Foto ulang
              </Button>
            </div>
          </Card>
        )}

        <Card className="mt-3 text-center">
          <p className="text-sm font-semibold text-muted-foreground">Total kalori foto ini</p>
          <p className="mt-1 text-[3.5rem] leading-none font-extrabold tracking-tighter tabular-nums">
            {fmtInt(totalKcal)}
          </p>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">kcal</p>
          {totalKcal > 0 && (
            <p className="mt-3 flex items-center justify-center gap-1.5 text-lg font-bold text-primary">
              {totalKcal > 550 ? (
                <TriangleAlert className="size-5" aria-hidden />
              ) : (
                <ThumbsUp className="size-5" aria-hidden />
              )}
              {reaction(totalKcal)}
            </p>
          )}
          {totalKcal > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              <Drumstick
                strokeWidth={1.5}
                className="mr-1 inline size-4 align-text-bottom"
                aria-hidden
              />
              {fmtInt(Math.round(totalKcal / GEPREK_KCAL))} porsi geprek
            </p>
          )}
          {items.length > 0 && (
            <ShareStoryButton
              variant="secondary"
              className="mt-4 w-full md:w-auto"
              story={{
                kind: "meal",
                name:
                  items.length > 1
                    ? `${items[0]!.name} +${items.length - 1} lainnya`
                    : items[0]!.name,
                kcal: totalKcal,
                protein: items.reduce((sum, item) => sum + (item.protein ?? 0), 0),
                carbs: items.reduce((sum, item) => sum + (item.carbs ?? 0), 0),
                fat: items.reduce((sum, item) => sum + (item.fat ?? 0), 0),
                reaction: totalKcal > 0 ? reaction(totalKcal) : undefined,
                photoSrc: photoUrl,
              }}
            />
          )}
        </Card>

        {askFeedback && !feedbackAnswered && photoId && (
          <Card className="mt-3 px-5 py-4" role="form" aria-label="Penilaian hasil AI">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold">Hasilnya akurat?</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Jawabanmu melatih perkiraan berikutnya.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Lewati penilaian"
                onClick={() => {
                  sendFeedback("dilewati");
                  setFeedbackAnswered(true);
                }}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
            {feedbackRating === null ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    sendFeedback("akurat");
                    setFeedbackAnswered(true);
                  }}
                >
                  <ThumbsUp className="size-4" aria-hidden />
                  Akurat
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFeedbackRating("kurang_akurat")}
                >
                  Kurang akurat
                </Button>
                <Button variant="outline" size="sm" onClick={() => setFeedbackRating("salah")}>
                  Salah
                </Button>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2" role="group" aria-label="Alasan">
                  {FEEDBACK_REASONS.map(([key, label]) => {
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
                        {label}
                      </button>
                    );
                  })}
                </div>
                <Input
                  aria-label="Catatan tambahan (opsional)"
                  value={feedbackNote}
                  maxLength={300}
                  onChange={(event) => setFeedbackNote(event.target.value)}
                  placeholder="Catatan singkat (opsional)"
                  autoComplete="off"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      sendFeedback(feedbackRating, feedbackReasons, feedbackNote);
                      setFeedbackAnswered(true);
                    }}
                  >
                    Kirim
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setFeedbackRating(null)}>
                    Kembali
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}

        <section className="mt-7" aria-label="Makanan yang dikenali">
          <SectionTitle
            action={
              <span className="text-xs font-semibold text-muted-foreground">
                Angkanya bisa dikoreksi
              </span>
            }
          >
            Yang AI lihat
          </SectionTitle>
          <ListGroup>
            {items.map((item, index) => (
              <li
                key={`${item.name}-${index}`}
                className="relative flex min-h-14 items-center gap-3 px-5 py-3"
              >
                {crops[index] || stickers[index] ? (
                  <CutoutImage
                    crop={crops[index]}
                    sticker={stickers[index]}
                    name=""
                    className="chip-pop size-11 shrink-0 rounded-xl motion-reduce:animate-none"
                  />
                ) : cropping && item.box ? (
                  <Skeleton className="size-11 shrink-0 rounded-xl" aria-hidden />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem] font-semibold">{item.name}</span>
                  <span className="mt-0.5 block truncate text-[0.8125rem] text-muted-foreground">
                    {[
                      item.portion,
                      item.grams != null ? `± ${fmtInt(item.grams)} g` : null,
                      item.confidence != null
                        ? `Keyakinan ${Math.round(item.confidence * 100)}%`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {(item.protein != null || item.carbs != null || item.fat != null) && (
                    <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                      P {fmtInt(item.protein ?? 0)} · K {fmtInt(item.carbs ?? 0)} · L{" "}
                      {fmtInt(item.fat ?? 0)} · S {fmtInt(item.fiber ?? 0)} g
                    </span>
                  )}
                  <span className="mt-1 block">
                    <KindCycleChip
                      value={kinds[index] ?? item.kind}
                      onChange={(next) => setKinds((current) => ({ ...current, [index]: next }))}
                    />
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Input
                    aria-label={`Kalori ${item.name}`}
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={kcals[index] ?? String(item.kcal)}
                    onChange={(event) =>
                      setKcals((current) => ({ ...current, [index]: event.target.value }))
                    }
                    className="h-11 w-24 text-right font-bold tabular-nums"
                  />
                  <span className="text-xs font-semibold text-muted-foreground">kcal</span>
                </span>
              </li>
            ))}
          </ListGroup>
        </section>

        {photoId && (
          <section className="mt-7" aria-label="Hitung ulang hasil AI">
            <SectionTitle
              action={
                <span className="text-xs font-semibold text-muted-foreground">
                  {retriesLeft > 0 ? `Gratis, sisa ${retriesLeft}x` : "Batas hitung ulang habis"}
                </span>
              }
            >
              Angka kurang pas?
            </SectionTitle>
            <Card className="mt-3 space-y-3 px-5 py-4">
              <p className="text-sm text-muted-foreground">
                AI membaca ulang foto yang sama tanpa foto ulang dan tanpa memakai kuota harian.
              </p>
              {retriesLeft > 0 ? (
                <>
                  <div>
                    <FieldLabel htmlFor="retry-hint">Koreksi singkat (opsional)</FieldLabel>
                    <Input
                      id="retry-hint"
                      value={retryHint}
                      maxLength={200}
                      onChange={(event) => setRetryHint(event.target.value)}
                      placeholder="mis. nasinya nasi merah, porsi setengah"
                      autoComplete="off"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => void retryAnalysis()}
                      disabled={retrying}
                    >
                      {retrying ? (
                        <>
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                          Menghitung ulang...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="size-4" aria-hidden />
                          Hitung ulang
                        </>
                      )}
                    </Button>
                    {retrying && (
                      <p className="text-sm text-muted-foreground animate-pulse" role="status">
                        Hasil sebelumnya masih ditampilkan.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm font-semibold text-muted-foreground">
                  Foto ini sudah dihitung ulang dua kali. Foto ulang lewat tombol di atas ya.
                </p>
              )}
              {retryError && (
                <p className="text-sm font-semibold text-destructive" role="alert">
                  Hasil sebelumnya tetap terpakai. {retryError}
                </p>
              )}
            </Card>
          </section>
        )}

        <section className="mt-7" aria-label="Catat ke waktu makan">
          <SectionTitle>Catat ke waktu makan</SectionTitle>
          <Segmented
            label="Waktu makan"
            value={meal}
            onChange={(value) => {
              mealPickedRef.current = true;
              setMeal(value);
            }}
            options={MEALS.map(([key, mealLabel]) => ({ value: key, label: mealLabel }))}
          />
        </section>

        <SnackAdviceCard
          className="mt-5"
          state={advice}
          onHalf={halve}
          halfApplied={fullItems !== null}
          onUndoHalf={undoHalf}
        />

        <section className="mt-7" aria-label="Harga piring">
          <SectionTitle
            action={
              <span className="text-xs font-semibold text-muted-foreground">
                Opsional, sekali per piring
              </span>
            }
          >
            Harga sepiring
          </SectionTitle>
          <Card className="space-y-3 px-5 py-4">
            <div className="flex items-end gap-3">
              <div className="w-36">
                <FieldLabel htmlFor="plate-price">Harga (Rp)</FieldLabel>
                <IdrInput
                  id="plate-price"
                  value={platePrice}
                  onChange={setPlatePrice}
                  placeholder="mis. 28.000"
                />
              </div>
              <div className="min-w-0 flex-1">
                <FieldLabel htmlFor="plate-name">Nama piring</FieldLabel>
                <Input
                  id="plate-name"
                  value={plateName}
                  onChange={(event) => setPlateName(event.target.value)}
                  placeholder="Nasi padang"
                  autoComplete="off"
                />
              </div>
            </div>
            <div>
              <FieldLabel htmlFor="plate-place">Tempat (opsional)</FieldLabel>
              <Input
                id="plate-place"
                value={platePlace}
                onChange={(event) => setPlatePlace(event.target.value)}
                placeholder="RM Sederhana"
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

        {/* Mobile: the primary pill floats above the tab bar; desktop: inline. */}
        <div className="fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-30 px-4 md:static md:mt-6 md:px-0">
          <div className="mx-auto flex max-w-[41rem] items-center gap-2 md:max-w-none">
            <Button
              size="lg"
              className="w-full shadow-float md:w-auto"
              onClick={() => void saveAll()}
              disabled={saving || retrying}
            >
              {saving ? "Menyimpan..." : `Simpan ke ${MEAL_LABELS[meal]}`}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={reset}
              disabled={saving || retrying}
              className="hidden md:inline-flex"
            >
              Batalkan
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
        title="Pindai makanan"
        subtitle="Foto piringmu, AI hitung kalorinya."
        action={
          <Link to="/makan">
            <Button variant="ghost" size="sm">
              Kembali
            </Button>
          </Link>
        }
      />

      {error && (
        <Card role="alert">
          <span className="flex size-9 items-center justify-center rounded-full bg-destructive/10">
            <TriangleAlert className="size-[1.125rem] text-destructive" aria-hidden />
          </span>
          <p className="mt-3 text-[0.9375rem] font-bold">
            {SCAN_FAIL_COPY[errorReason ?? "failed"].title}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{error}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => cameraInputRef.current?.click()}>
              Foto ulang
            </Button>
            <Button variant="secondary" size="sm" onClick={() => galleryInputRef.current?.click()}>
              Pilih dari galeri
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setError(null);
                setErrorReason(null);
              }}
            >
              Tutup
            </Button>
          </div>
        </Card>
      )}

      <Card className={cn("flex flex-col items-center p-8 text-center", error && "mt-3")}>
        <span
          className="flex size-20 items-center justify-center rounded-full bg-makan-soft"
          aria-hidden
        >
          <Camera className="size-8 text-makan-ink" />
        </span>
        <h2 className="mt-5 text-xl font-bold tracking-tight">Arahkan ke piringmu</h2>
        <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
          AI mengenali masakan Indonesia dan menghitung kalorinya. Kamu bisa koreksi dulu sebelum
          disimpan.
        </p>
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-makan-soft px-3.5 py-1.5 text-sm font-semibold text-makan-ink">
          <Lightbulb className="size-4 shrink-0" aria-hidden />1 piring per foto, dari dekat
        </p>
        <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:w-auto">
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
            Buka Kamera
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
            Pilih dari Galeri
          </label>
        </div>
        <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          {profile.data?.profile?.keepPhotos
            ? "Foto asli disimpan untukmu sendiri. Atur di Profil."
            : "Foto hanya dipakai untuk analisis dan tidak disimpan."}
        </p>
      </Card>

      <Link
        to="/makan"
        search={{ cerita: true }}
        className="mt-3 flex min-h-14 items-center gap-3 rounded-3xl bg-card px-5 py-3 transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">Lupa foto?</span>
          <span className="block text-sm text-muted-foreground">
            Ceritakan saja makananmu, ketik atau pakai suara.
          </span>
        </span>
        <Mic className="size-5 shrink-0 text-primary" aria-hidden />
      </Link>

      <Link
        to="/makan/barcode"
        search={scanDate ? { date: scanDate } : {}}
        className="mt-3 flex min-h-14 items-center gap-3 rounded-3xl bg-card px-5 py-3 transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">Makanan kemasan?</span>
          <span className="block text-sm text-muted-foreground">
            Pindai barcode-nya, angka gizi diambil dari Open Food Facts.
          </span>
        </span>
        <ScanBarcode className="size-5 shrink-0 text-primary" aria-hidden />
      </Link>
    </Page>
  );
}
