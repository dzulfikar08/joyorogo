import {
  Camera,
  Check,
  Drumstick,
  Images,
  Loader2,
  Mic,
  RefreshCw,
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

import { MEAL_LABELS, effectiveRamadan, slotsFor, suggestMealNow } from "@joyorogo/api/lib/engine";
import { randomFact } from "@joyorogo/api/lib/facts";
import type { Meal } from "@joyorogo/api/lib/engine";
import { Button, buttonVariants } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
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
import { ShareStoryButton } from "@/components/story/share-story-button";
import { cropItems } from "@/lib/crop";
import type { AiFoodItem } from "@/lib/api-types";
import { isPaywallError } from "@/lib/billing";
import { fmtInt, parseNum } from "@/lib/format";
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

/**
 * Client-side resize to <= 1024 px; WebP when the browser can encode it
 * (smaller upload on 4G), JPEG fallback elsewhere. Inference cost is driven
 * by pixel count, so the edge cap is what keeps it cheap. The original is
 * only kept when the user turned on "Simpan foto asli".
 */
async function fileToImageBase64(
  file: File,
): Promise<{ base64: string; mimeType: "image/jpeg" | "image/webp" }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Browser ini tidak mendukung pengolahan gambar.");
  }
  // Flatten alpha onto white — gallery cutouts/screenshots with transparency
  // get rejected by the vision model otherwise ("could not be decoded").
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/webp", 0.82);
  if (dataUrl.startsWith("data:image/webp")) {
    return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/webp" };
  }
  const jpegUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: jpegUrl.slice(jpegUrl.indexOf(",") + 1), mimeType: "image/jpeg" };
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
  const [image, setImage] = useState<{
    base64: string;
    mimeType: "image/jpeg" | "image/webp";
  } | null>(null);
  const [crops, setCrops] = useState<Array<string | null>>([]);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const ramadan = effectiveRamadan(profile.data?.profile?.ramadanMode);
  const MEALS = (Object.entries(MEAL_LABELS) as Array<[Meal, string]>).filter(([meal]) =>
    slotsFor(ramadan).includes(meal),
  );
  const [meal, setMeal] = useState<Meal>(suggestMealNow(new Date(), ramadan));
  const [error, setError] = useState<string | null>(null);
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

  // Live total of the (editable) per-item kcal — drives the big number
  // and the reaction line on the confirm screen.
  const totalKcal = items.reduce(
    (sum, item, index) => sum + (parseNum(kcals[index] ?? String(item.kcal)) ?? 0),
    0,
  );

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
      const result = await client.ai.analyzeFood(
        { imageBase64: image.base64, mimeType: image.mimeType, crops: true },
        { signal: controller.signal },
      );
      if (runRef.current !== run) return;
      const itemCrops = await cropItems(
        `data:${image.mimeType};base64,${image.base64}`,
        result.items.map((item) => item.box),
      ).catch(() => result.items.map(() => null));
      if (runRef.current !== run) return;
      setImage(image);
      setItems(result.items);
      setQuotaReached(result.quotaReached);
      setCrops(itemCrops);
      setKcals(Object.fromEntries(result.items.map((item, index) => [index, String(item.kcal)])));
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
      setPhase("idle");
    }
  };

  const reset = () => {
    runRef.current += 1;
    abortRef.current?.abort();
    retryAbortRef.current?.abort();
    setPhase("idle");
    setItems([]);
    setKcals({});
    setImage(null);
    setCrops([]);
    setQuotaReached(false);
    setPhotoUrl(null);
    setPlateName("");
    setPlatePlace("");
    setPlatePrice("");
    setError(null);
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
      const itemCrops = await cropItems(
        `data:${image.mimeType};base64,${image.base64}`,
        result.items.map((item) => item.box),
      ).catch(() => result.items.map(() => null));
      setItems(result.items);
      setCrops(itemCrops);
      setKcals(Object.fromEntries(result.items.map((item, index) => [index, String(item.kcal)])));
      setRetriesLeft(result.retriesLeft);
      setRetryHint("");
      setModel(result.model ?? model);
      setRetryCount((count) => count + 1);
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
    const priceNum = platePrice.trim() === "" ? null : parseNum(platePrice);
    if (platePrice.trim() !== "" && (priceNum === null || priceNum < 0)) {
      toast.error("Harga sepiring belum valid (angka rupiah).");
      setSaving(false);
      return;
    }
    const plate = {
      name: plateName.trim() || undefined,
      place: platePlace.trim() || undefined,
      ...(priceNum != null ? { priceIdr: Math.round(priceNum) } : {}),
    };
    try {
      // One call: photo stored once, one row and one sticker per item.
      const saved = await client.food.addScan({
        date: scanDate,
        meal,
        imageBase64: image.base64,
        mimeType: image.mimeType,
        itemsJson: JSON.stringify(items),
        ...(plate.name || plate.place || plate.priceIdr != null ? { plate } : {}),
        items: items.map((item, index) => ({
          name: item.name,
          kcal: values[index]!,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          fiber: item.fiber,
          box: item.box,
        })),
      });
      // Miss log: AI estimate vs what the user kept. Never blocks the save.
      void client.ai
        .logCorrections({
          source: "web",
          items: items.map((item, index) => ({
            meal,
            dishName: item.name,
            aiKcal: Math.round(item.kcal),
            savedKcal: values[index] ?? 0,
            aiGrams: item.grams ?? null,
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
        <PageHeader title="Menganalisis foto" subtitle="Sebentar ya, biasanya 3 sampai 9 detik." />
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
            {crops.some(Boolean) && (
              <ul
                className="mt-4 flex flex-wrap justify-center gap-3"
                aria-label="Potongan tiap makanan"
              >
                {items.map((item, index) =>
                  crops[index] ? (
                    <li
                      key={`${item.name}-${index}`}
                      className="chip-pop flex w-24 flex-col items-center gap-1 motion-reduce:animate-none"
                      style={{ animationDelay: `${200 + index * 70}ms` }}
                    >
                      <img
                        src={crops[index]!}
                        alt={item.name}
                        className="size-20 rounded-2xl object-cover shadow-sm"
                      />
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
                  items.length > 1 ? `${items[0]!.name} +${items.length - 1} lainnya` : items[0]!.name,
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
                <Button variant="outline" size="sm" onClick={() => setFeedbackRating("kurang_akurat")}>
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
                {crops[index] ? (
                  <img
                    src={crops[index]!}
                    alt=""
                    aria-hidden
                    className="size-11 shrink-0 rounded-xl object-cover"
                  />
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
                  {retriesLeft > 0
                    ? `Gratis, sisa ${retriesLeft}x`
                    : "Batas hitung ulang habis"}
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
                    <Button variant="secondary" onClick={() => void retryAnalysis()} disabled={retrying}>
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
            onChange={setMeal}
            options={MEALS.map(([key, mealLabel]) => ({ value: key, label: mealLabel }))}
          />
        </section>

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
                <Input
                  id="plate-price"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={platePrice}
                  onChange={(event) => setPlatePrice(event.target.value)}
                  placeholder="28000"
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
        <div className="rounded-3xl bg-card p-5" role="alert">
          <p className="text-sm font-bold text-destructive">Gagal menganalisis foto</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => galleryInputRef.current?.click()}>
              Coba foto lain
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setError(null)}>
              Tutup
            </Button>
          </div>
        </div>
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
    </Page>
  );
}
