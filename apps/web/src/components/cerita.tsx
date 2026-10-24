import { kcalUnit } from "@joyorogo/i18n";
import { eatenAtClock, eatenAtFromClock } from "@joyorogo/api/lib/eaten-at";
import { MEALS, jakartaToday, relativeDayLabel, storySlotLabel } from "@joyorogo/api/lib/engine";
import { parseIdrInput } from "@joyorogo/api/lib/format";
import { copyChipLabel, copyWantedLabel } from "@joyorogo/api/lib/meal-copy-label";
import { gramsForTypedKcal, macrosForTypedKcal } from "@joyorogo/api/lib/portion";
import type { Meal } from "@joyorogo/api/lib/engine";
import type { TFunction } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Textarea } from "@joyorogo/ui/components/textarea";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Mic, Repeat, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { StoryFoodItem, StoryReference, StoryResult } from "@/lib/api-types";
import { isPaywallError } from "@/lib/billing";
import { removeById } from "@joyorogo/api/lib/optimistic";
import { Chip } from "@/components/chip";
import { FieldLabel } from "@/components/kit/surface";
import { FoodSafetyNotes } from "@/components/maternal/food-safety-notes";
import { MetaLine } from "@/components/meta-line";
import { EatenAtField } from "@/components/plate/eaten-at-field";
import { IdrInput } from "@/components/plate/idr-input";
import { fmtGramsLabel, fmtInt, fmtKcalLabel, parseNum } from "@/lib/format";
import { OptimisticCache, undoLabel, UNDO_TOAST_MS } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

/** Whisper reads these as-is: Chrome/Firefox record webm/opus, Safari mp4/aac. */
const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
/** One minute covers a whole day of meals and keeps uploads near 0.5 MB. */
const MAX_RECORD_MS = 60_000;

function recorderMime(): string | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return null;
  if (!navigator.mediaDevices?.getUserMedia) return null;
  return AUDIO_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function joinDays(days: string[], t: TFunction<["makan", "common"]>): string {
  if (days.length <= 1) return days[0] ?? "";
  return t("story.joinLast", { list: days.slice(0, -1).join(", "), last: days.at(-1) });
}

/** Server errors carry user-facing copy; the transcript survives a failed parse. */
function errorParts(
  err: unknown,
  t: TFunction<["makan", "common"]>,
): { message: string; transcript: string | null } {
  const message =
    err instanceof Error && err.message ? err.message : t("story.error.generic");
  const data = (err as { data?: { transcript?: unknown } } | null)?.data;
  return { message, transcript: typeof data?.transcript === "string" ? data.transcript : null };
}

export type CeritaPhase = "input" | "recording" | "listening" | "thinking" | "review";

/**
 * "Ceritakan": type or say what you ate, AI places each item on a meal slot
 * and day, the user checks the numbers, one tap saves everything.
 * `meal` pins stories without a meal word to the slot the sheet came from.
 */
export function Cerita({
  meal,
  date,
  eatenAt: sheetEatenAt = null,
  slots,
  onPhaseChange,
  onSaved,
  onShowDate,
}: {
  meal?: Meal;
  date: string;
  /** "Jam makan" already picked in the add sheet (unix ms): starts the review group of that slot and day. */
  eatenAt?: number | null;
  slots: Meal[];
  onPhaseChange?: (phase: CeritaPhase) => void;
  onSaved: (dates: string[]) => void;
  /** Offered as a toast action when items landed on a day other than `date`. */
  onShowDate?: (date: string) => void;
}) {
  const { t } = useTranslation(["makan", "common"]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [phase, setPhaseState] = useState<CeritaPhase>("input");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [items, setItems] = useState<StoryFoodItem[]>([]);
  const [kcals, setKcals] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // This story used the free user's last quota of today: offer Founder once
  // the items are saved.
  const [quotaReached, setQuotaReached] = useState(false);
  // The earlier meal this story copied, or why it could not (empty slot, everything removed).
  const [reference, setReference] = useState<StoryReference | null>(null);
  const [notice, setNotice] = useState<StoryReference | null>(null);
  const [copying, setCopying] = useState(false);
  const activeSlots = slots.length > 0 ? slots : [...MEALS];
  const recentMeals =
    useQuery(orpc.food.recentMeals.queryOptions({ input: { date, meal, slots: activeSlots } })).data
      ?.groups ?? [];
  // Optional price per plate group ("Nasi padang" / "RM Sederhana" / "28000"),
  // prefilled from the last known price when the review screen opens.
  const [plates, setPlates] = useState<
    Record<string, { name: string; place: string; price: string }>
  >({});
  // "Jam makan" per group (unix ms); a missing key = Sekarang, nothing is sent.
  const [eatenAts, setEatenAts] = useState<Record<string, number | null>>({});
  const [elapsed, setElapsed] = useState(0);
  const [mime] = useState(recorderMime);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const discardRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const setPhase = (next: CeritaPhase) => {
    setPhaseState(next);
    onPhaseChange?.(next);
  };

  // Release the mic and any in-flight request when the sheet closes.
  useEffect(
    () => () => {
      discardRef.current = true;
      recorderRef.current?.stop();
      abortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (phase !== "recording") return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= MAX_RECORD_MS) recorderRef.current?.stop();
    }, 250);
    return () => clearInterval(timer);
  }, [phase]);

  /** Show an answer: items go to the review screen; an empty copy stays on the input with a notice. */
  const showResult = (result: StoryResult) => {
    setTranscript(result.transcript);
    // A one-tap copy has no story of its own: leave whatever the user typed.
    if (result.reference?.via !== "chip") setText(result.transcript);
    setReference(result.reference);
    if (result.items.length === 0 && result.reference) {
      setNotice(result.reference);
      setPhase("input");
      return;
    }
    setNotice(null);
    setItems(result.items);
    setQuotaReached(result.quotaReached);
    setKcals(result.items.map((item) => String(Math.round(item.kcal))));
    // Autofill each group's plate from the last price paid for that name.
    const groupsByKey = [...new Set(result.items.map(groupKey))];
    setEatenAts(
      sheetEatenAt === null
        ? {}
        : Object.fromEntries(
            result.items
              .filter((item) => item.date === date && item.meal === meal)
              .map((item) => [groupKey(item), sheetEatenAt]),
          ),
    );
    setPlates(
      Object.fromEntries(groupsByKey.map((key) => [key, { name: "", place: "", price: "" }])),
    );
    for (const key of groupsByKey) {
      const sample = result.items.find((item) => groupKey(item) === key);
      if (!sample) continue;
      client.plate
        .lastPrice({ name: sample.name })
        .then((hit) => {
          if (!hit) return;
          setPlates((current) =>
            current[key]?.price
              ? current
              : {
                  ...current,
                  [key]: { name: hit.name, place: hit.place ?? "", price: String(hit.priceIdr) },
                },
          );
        })
        .catch(() => {});
    }
    setPhase("review");
  };

  const describe = async (input: { text: string } | { audioBase64: string }) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setNotice(null);
    setPhase("audioBase64" in input ? "listening" : "thinking");
    try {
      const result = await client.ai.describeFood(
        { ...input, meal, date, slots: activeSlots },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      showResult(result);
    } catch (err) {
      if (controller.signal.aborted) return;
      // Story rejected because the free quota ran out: paywall instead of an
      // error line.
      if (isPaywallError(err)) {
        navigate({ to: "/pro", search: { from: "quota", next: "/makan" } });
        return;
      }
      const parts = errorParts(err, t);
      if (parts.transcript) setText(parts.transcript);
      setError(parts.message);
      setPhase("input");
    }
  };

  /** One-tap repeat of a logged meal: no AI, same review screen. */
  const copyFrom = async (from: { date: string; meal: Meal }, label: string) => {
    setCopying(true);
    setError(null);
    setNotice(null);
    try {
      const result = await client.food.copyMeal({ from: { date: from.date, meal: from.meal }, meal, date, slots: activeSlots });
      showResult({ ...result, transcript: label });
    } catch {
      setError(t("story.copy.failed"));
    } finally {
      setCopying(false);
    }
  };

  const startRecording = async () => {
    if (mime === null) return;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t("story.error.micDenied"));
      return;
    }
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    discardRef.current = false;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      recorderRef.current = null;
      if (discardRef.current) {
        setPhase("input");
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
      if (blob.size < 1000) {
        setError(t("story.error.tooShort"));
        setPhase("input");
        return;
      }
      void blobToBase64(blob).then((audioBase64) => describe({ audioBase64 }));
    };
    recorderRef.current = recorder;
    recorder.start();
    setPhase("recording");
  };

  const stopRecording = (discard: boolean) => {
    discardRef.current = discard;
    recorderRef.current?.stop();
  };

  const backToInput = () => {
    setItems([]);
    setEatenAts({});
    setKcals([]);
    setReference(null);
    setPhase("input");
  };

  const remove = (index: number) => {
    const nextItems = items.filter((_, i) => i !== index);
    setItems(nextItems);
    setKcals((current) => current.filter((_, i) => i !== index));
    if (nextItems.length === 0) backToInput();
  };

  /** The copy that could not be shown: nothing logged there, or every item removed. */
  const noticeLines = (info: StoryReference): string[] => {
    if (info.status === "emptied") return [t("story.copy.emptied")];
    const today = jakartaToday();
    const what = copyWantedLabel(info.wanted, today);
    const lines = [what ? t("story.copy.empty", { what }) : t("story.copy.emptyAny")];
    if (info.suggestion) {
      lines.push(
        t("story.copy.suggest", {
          label: storySlotLabel(info.suggestion.date, info.suggestion.meal, today),
          kcal: fmtInt(info.suggestion.kcal),
        }),
      );
    }
    return lines;
  };

  const total = kcals.reduce((sum, value) => sum + (parseNum(value) ?? 0), 0);

  // Cerita group key: one plate per distinct date+meal — each gets its own
  // optional price, like separate plates at different warungs.
  const groupKey = (item: StoryFoodItem) => `${item.date}-${item.meal}`;

  const updatePlate = (
    key: string,
    patch: Partial<{ name: string; place: string; price: string }>,
  ) =>
    setPlates((current) => {
      const prev = current[key] ?? { name: "", place: "", price: "" };
      return { ...current, [key]: { ...prev, ...patch } };
    });

  const saveAll = async () => {
    const values = kcals.map((value) => parseNum(value));
    const invalid = values.findIndex((value) => value === null || value < 0);
    if (invalid !== -1) {
      toast.error(t("story.error.kcalInvalid", { name: items[invalid]?.name }));
      return;
    }
    setSaving(true);
    let saved = 0;
    const created: Array<{
      id: string;
      date: string;
      meal: string;
      kcal: number;
      protein?: number | null;
      carbs?: number | null;
      fat?: number | null;
      fiber?: number | null;
    }> = [];
    try {
      let plateId: string | null = null;
      let plateGroup: string | null = null;
      for (const [index, item] of items.entries()) {
        const group = groupKey(item);
        const plateForm = plates[group];
        // First item of a group creates the plate; the rest join it.
        const startsGroup = group !== plateGroup;
        const priceNum = plateForm ? parseIdrInput(plateForm.price) : null;
        if (priceNum !== null && priceNum < 0) {
          throw new Error(t("story.error.priceInvalid"));
        }
        const groupEatenAt = eatenAts[group] ?? null;
        const row = await client.food.add({
          date: item.date,
          meal: item.meal,
          name: item.name,
          kcal: values[index]!,
          grams: gramsForTypedKcal(item, values[index]!),
          ...macrosForTypedKcal(item, values[index]!),
          source: item.copied ? "copy" : "ai",
          ...(startsGroup
            ? {
                plate: {
                  name: plateForm?.name.trim() || undefined,
                  place: plateForm?.place.trim() || undefined,
                  ...(priceNum != null ? { priceIdr: Math.round(priceNum) } : {}),
                },
              }
            : plateId
              ? { plateId }
              : {}),
          ...(groupEatenAt !== null
            ? { eatenAt: eatenAtFromClock(item.date, eatenAtClock(groupEatenAt)) ?? undefined }
            : {}),
        });
        if (startsGroup) {
          plateGroup = group;
          plateId = row?.plateId ?? null;
        }
        if (row) {
          created.push({
            id: row.id,
            date: row.date,
            meal: row.meal,
            kcal: row.kcal,
            protein: row.protein,
            carbs: row.carbs,
            fat: row.fat,
            fiber: row.fiber,
          });
        }
        saved += 1;
      }
      const estimated = items.flatMap((item, index) => (item.copied ? [] : [{ item, index }]));
      // Copied rows carry the log's own numbers: nothing was estimated, nothing to learn from.
      if (estimated.length > 0) {
        void client.ai
          .logCorrections({
            source: "web",
            items: estimated.map(({ item, index }) => ({
              meal: item.meal,
              dishName: item.name,
              aiKcal: Math.round(item.kcal),
              savedKcal: values[index] ?? 0,
              aiGrams: item.grams ?? null,
              aiConfidence: item.confidence ?? null,
            })),
          })
          .catch(() => {});
      }
      const dates = [...new Set(items.map((item) => item.date))].sort();
      const today = jakartaToday();
      const elsewhere = dates.find((d) => d !== date);
      // Undo removes every row this story created and reverses the summaries.
      const createdRows = created;
      toast.success(
        t("story.toast.saved", {
          count: saved,
          days: joinDays(
            dates.map((d) => relativeDayLabel(d, today)),
            t,
          ),
        }),
        createdRows.length > 0
          ? {
              duration: UNDO_TOAST_MS,
              action: {
                label: undoLabel(),
                onClick: () => {
                  const cache = new OptimisticCache(queryClient);
                  for (const row of createdRows) {
                    // food.listByDate caches hold { items, totals }: strip the
                    // row and pull the rendered totals down with it.
                    cache.value<{
                      items: Array<{ id: string }>;
                      totals: {
                        kcal: number;
                        protein: number;
                        carbs: number;
                        fat: number;
                        fiber: number;
                      };
                    }>(
                      orpc.food.listByDate.queryOptions({ input: { date: row.date } }).queryKey,
                      (old) => {
                        if (!old || !old.items.some((item) => item.id === row.id)) return old;
                        return {
                          ...old,
                          items: removeById(old.items, row.id),
                          totals: {
                            kcal: Math.max(0, old.totals.kcal - row.kcal),
                            protein: Math.max(0, old.totals.protein - (row.protein ?? 0)),
                            carbs: Math.max(0, old.totals.carbs - (row.carbs ?? 0)),
                            fat: Math.max(0, old.totals.fat - (row.fat ?? 0)),
                            fiber: Math.max(0, old.totals.fiber - (row.fiber ?? 0)),
                          },
                        };
                      },
                    );
                    cache.summary({
                      date: row.date,
                      kcal: -row.kcal,
                      meal: row.meal,
                      meals: -1,
                    });
                    void client.food.remove({ id: row.id });
                  }
                },
              },
            }
          : elsewhere && onShowDate
            ? { action: { label: t("story.toast.show"), onClick: () => onShowDate(elsewhere) } }
            : undefined,
      );
      queryClient.invalidateQueries({ queryKey: orpc.food.key() });
      queryClient.invalidateQueries({ queryKey: orpc.day.key() });
      queryClient.invalidateQueries({ queryKey: orpc.fasting.key() });
      onSaved(dates);
      // The save landed first, so nothing is lost: now offer Founder to the
      // user who just spent their last free story scan.
      if (quotaReached) {
        navigate({ to: "/pro", search: { from: "quota", next: "/makan" } });
      }
    } catch (err) {
      toast.error(errorParts(err, t).message);
      // Keep only what did not make it, so a retry never double-logs.
      setItems((current) => current.slice(saved));
      setKcals((current) => current.slice(saved));
    } finally {
      setSaving(false);
    }
  };

  if (phase === "listening" || phase === "thinking") {
    return (
      <div role="status" className="rounded-2xl bg-muted p-5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="size-2.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
          />
          <p className="text-sm font-bold">
            {phase === "listening" ? t("story.listening") : t("story.thinking")}
          </p>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("story.eta")}</p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-3"
          onClick={() => {
            abortRef.current?.abort();
            setPhase("input");
          }}
        >
          {t("story.cancelRequest")}
        </Button>
      </div>
    );
  }

  if (phase === "review") {
    const today = jakartaToday();
    const order = groupKey;
    const indexed = items.map((item, index) => ({ item, index }));
    const groups = [...new Set(indexed.map(({ item }) => order(item)))]
      .sort()
      .map((key) => indexed.filter(({ item }) => order(item) === key));
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-muted px-4 py-3">
          {reference?.via !== "chip" && (
            <>
              <p className="text-xs font-semibold text-muted-foreground">{t("story.youSaid")}</p>
              <p className="mt-0.5 text-sm">{transcript}</p>
            </>
          )}
          {reference?.status === "copied" && reference.from && (
            <p
              className={
                reference.via === "chip" ? "text-sm" : "mt-1 text-xs text-muted-foreground"
              }
            >
              {t("story.copy.copiedFrom", {
                label: storySlotLabel(reference.from.date, reference.from.meal, today),
              })}
            </p>
          )}
          <button
            type="button"
            onClick={backToInput}
            disabled={saving}
            className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            {t("story.editStory")}
          </button>
        </div>

        {groups.map((group) => {
          const first = group[0]!.item;
          const label = storySlotLabel(first.date, first.meal, today);
          return (
            <section key={label} aria-label={label}>
              <h3 className="mb-2 px-1 text-sm font-bold">{label}</h3>
              <ul className="space-y-2">
                {group.map(({ item, index }) => (
                  <li
                    key={`${item.name}-${index}`}
                    className="flex items-center gap-2 rounded-2xl bg-muted py-2 pr-2 pl-4"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.9375rem] font-semibold">
                        {item.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.portion || item.grams != null || item.usualDensity ? (
                          <MetaLine
                            items={[
                              item.portion,
                              item.grams != null ? `± ${fmtGramsLabel(item.grams)}` : null,
                              item.usualDensity && kcals[index] === String(item.kcal)
                                ? t("story.usual", { kcal: fmtKcalLabel(item.usualDensity.modelKcal) })
                                : null,
                              item.portionPrior && kcals[index] === String(item.kcal)
                                ? t("story.usualPortion", { grams: fmtGramsLabel(item.portionPrior.other.grams) })
                                : null,
                            ]}
                          />
                        ) : (
                          t("story.portionDefault")
                        )}
                      </span>
                    </span>
                    <Input
                      aria-label={t("story.kcalAria", { name: item.name })}
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={kcals[index] ?? ""}
                      onChange={(event) =>
                        setKcals((current) =>
                          current.map((v, i) => (i === index ? event.target.value : v)),
                        )
                      }
                      className="h-11 w-20 bg-card px-3 text-right font-bold"
                    />
                    <span className="text-xs font-semibold text-muted-foreground">{kcalUnit()}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("foodRow.delete", { name: item.name })}
                      onClick={() => remove(index)}
                      disabled={saving}
                      className="size-11 shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-end gap-2 rounded-2xl bg-card px-4 py-2">
                <div className="min-w-0 flex-1">
                  <FieldLabel htmlFor={`plate-${label}`}>{t("story.plateName")}</FieldLabel>
                  <Input
                    id={`plate-${label}`}
                    value={plates[order(first)]?.name ?? ""}
                    onChange={(event) => updatePlate(order(first), { name: event.target.value })}
                    placeholder={first.name}
                    autoComplete="off"
                    className="h-11 bg-muted"
                  />
                </div>
                <div className="w-32">
                  <FieldLabel htmlFor={`plate-price-${label}`}>{t("story.priceLabel")}</FieldLabel>
                  <IdrInput
                    id={`plate-price-${label}`}
                    value={plates[order(first)]?.price ?? ""}
                    onChange={(price) => updatePlate(order(first), { price })}
                    placeholder={t("story.pricePlaceholder", { example: fmtInt(28000) })}
                    className="h-11 bg-muted text-right font-bold"
                  />
                </div>
              </div>
              <div className="mt-2 rounded-2xl bg-card px-4 py-3">
                <EatenAtField
                  id={`story-eaten-at-${order(first)}`}
                  date={first.date}
                  meal={first.meal}
                  value={eatenAts[order(first)] ?? null}
                  onChange={(next) => setEatenAts((current) => ({ ...current, [order(first)]: next }))}
                />
              </div>
            </section>
          );
        })}

        <FoodSafetyNotes
          names={items.map((item) => item.name)}
          addToDay
          className="bg-transparent p-0"
        />

        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-semibold text-muted-foreground">{t("story.total")}</span>
          <span className="text-lg font-extrabold tabular-nums">
            {fmtInt(total)}{" "}
            <span className="text-xs font-semibold text-muted-foreground">{kcalUnit()}</span>
          </span>
        </div>
        <Button className="w-full" size="lg" onClick={() => void saveAll()} disabled={saving}>
          {saving ? t("story.saving") : t("story.saveAll", { count: items.length })}
        </Button>
      </div>
    );
  }

  const recording = phase === "recording";
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const clean = text.trim();
        if (clean.length < 2) {
          setError(t("story.error.empty"));
          return;
        }
        void describe({ text: clean });
      }}
      className="space-y-3"
    >
      <label htmlFor="cerita-text" className="sr-only">
        {t("story.inputLabel")}
      </label>
      {recording ? (
        <div
          role="status"
          className="flex min-h-28 flex-col items-center justify-center gap-1 rounded-xl bg-muted px-4 py-4 text-center"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <span
              aria-hidden
              className="size-2.5 animate-pulse rounded-full bg-destructive motion-reduce:animate-none"
            />
            {t("story.recording", { time: fmtClock(elapsed) })}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("story.recordingHint")}
          </span>
        </div>
      ) : (
        <Textarea
          id="cerita-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={1000}
          rows={3}
          placeholder={
            meal
              ? t("story.placeholder.meal")
              : t("story.placeholder.day")
          }
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "cerita-error" : undefined}
          className="min-h-28 rounded-xl border-transparent bg-muted px-4 py-3 text-base md:text-base focus-visible:border-ring/60 focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/25"
        />
      )}
      {notice && (
        <div role="status" className="space-y-2 rounded-2xl bg-muted px-4 py-3 text-sm">
          {noticeLines(notice).map((line) => (
            <p key={line}>{line}</p>
          ))}
          {notice.suggestion && (
            <Button
              type="button"
              size="sm"
              disabled={copying}
              onClick={() => void copyFrom(notice.suggestion!, storySlotLabel(notice.suggestion!.date, notice.suggestion!.meal, jakartaToday()))}
            >
              {t("story.copy.suggestAction")}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p id="cerita-error" role="alert" className="px-1 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        {mime !== null &&
          (recording ? (
            <>
              <Button type="button" variant="secondary" onClick={() => stopRecording(true)}>
                {t("common:actions.cancel")}
              </Button>
              <Button type="button" className="flex-1" onClick={() => stopRecording(false)}>
                <Square className="size-4" aria-hidden />
                {t("common:actions.done")}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label={t("story.record")}
              onClick={() => void startRecording()}
              className="size-12 shrink-0 rounded-full"
            >
              <Mic className="size-5" />
            </Button>
          ))}
        {!recording && (
          <Button type="submit" className="flex-1">
            {t("story.calculate")}
          </Button>
        )}
      </div>
      {!recording && recentMeals.length > 0 && (
        <div className="pt-1">
          <p className="text-sm font-bold">{t("story.copy.title")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("story.copy.hint")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {recentMeals.map((group) => {
              const today = jakartaToday();
              return (
                <Chip
                  key={`${group.date}-${group.meal}`}
                  className="max-w-full"
                  disabled={copying}
                  onClick={() => void copyFrom(group, copyChipLabel(group, today))}
                >
                  <Repeat className="mr-1.5 size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">
                    {copyChipLabel(group, today)} · {fmtKcalLabel(group.kcal)}
                  </span>
                </Chip>
              );
            })}
          </div>
        </div>
      )}
    </form>
  );
}
