import { MEALS, jakartaToday, relativeDayLabel, storySlotLabel } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Textarea } from "@joyorogo/ui/components/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { Mic, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { StoryFoodItem } from "@/lib/api-types";
import { fmtInt, parseNum } from "@/lib/format";
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

/** Server errors carry user-facing copy; the transcript survives a failed parse. */
function errorParts(err: unknown): { message: string; transcript: string | null } {
  const message =
    err instanceof Error && err.message ? err.message : "Gagal menghubungi AI. Coba lagi.";
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
  slots,
  onPhaseChange,
  onSaved,
  onShowDate,
}: {
  meal?: Meal;
  date: string;
  slots: Meal[];
  onPhaseChange?: (phase: CeritaPhase) => void;
  onSaved: (dates: string[]) => void;
  /** Offered as a toast action when items landed on a day other than `date`. */
  onShowDate?: (date: string) => void;
}) {
  const queryClient = useQueryClient();
  const [phase, setPhaseState] = useState<CeritaPhase>("input");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [items, setItems] = useState<StoryFoodItem[]>([]);
  const [kcals, setKcals] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
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

  const describe = async (input: { text: string } | { audioBase64: string }) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setPhase("audioBase64" in input ? "listening" : "thinking");
    try {
      const result = await client.ai.describeFood(
        { ...input, meal, date, slots: slots.length > 0 ? slots : [...MEALS] },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setTranscript(result.transcript);
      setText(result.transcript);
      setItems(result.items);
      setKcals(result.items.map((item) => String(Math.round(item.kcal))));
      setPhase("review");
    } catch (err) {
      if (controller.signal.aborted) return;
      const parts = errorParts(err);
      if (parts.transcript) setText(parts.transcript);
      setError(parts.message);
      setPhase("input");
    }
  };

  const startRecording = async () => {
    if (mime === null) return;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(
        "Izin mikrofon ditolak. Ketik saja ceritamu, atau izinkan mikrofon di pengaturan browser.",
      );
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
        setError("Rekamannya terlalu pendek. Tekan mikrofon, ceritakan, lalu tekan Selesai.");
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
    setKcals([]);
    setPhase("input");
  };

  const remove = (index: number) => {
    const nextItems = items.filter((_, i) => i !== index);
    setItems(nextItems);
    setKcals((current) => current.filter((_, i) => i !== index));
    if (nextItems.length === 0) backToInput();
  };

  const total = kcals.reduce((sum, value) => sum + (parseNum(value) ?? 0), 0);

  const saveAll = async () => {
    const values = kcals.map((value) => parseNum(value));
    const invalid = values.findIndex((value) => value === null || value < 0);
    if (invalid !== -1) {
      toast.error(`Kalori untuk "${items[invalid]?.name}" belum valid.`);
      return;
    }
    setSaving(true);
    let saved = 0;
    try {
      for (const [index, item] of items.entries()) {
        await client.food.add({
          date: item.date,
          meal: item.meal,
          name: item.name,
          kcal: values[index]!,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          fiber: item.fiber,
          source: "ai",
        });
        saved += 1;
      }
      void client.ai
        .logCorrections({
          source: "web",
          items: items.map((item, index) => ({
            meal: item.meal,
            dishName: item.name,
            aiKcal: Math.round(item.kcal),
            savedKcal: values[index] ?? 0,
            aiGrams: item.grams ?? null,
            aiConfidence: item.confidence ?? null,
          })),
        })
        .catch(() => {});
      const dates = [...new Set(items.map((item) => item.date))].sort();
      const today = jakartaToday();
      const elsewhere = dates.find((d) => d !== date);
      toast.success(
        `${saved} makanan dicatat ke ${dates.map((d) => relativeDayLabel(d, today)).join(" dan ")}.`,
        elsewhere && onShowDate
          ? { action: { label: "Lihat", onClick: () => onShowDate(elsewhere) } }
          : undefined,
      );
      queryClient.invalidateQueries({ queryKey: orpc.food.key() });
      queryClient.invalidateQueries({ queryKey: orpc.day.key() });
      onSaved(dates);
    } catch (err) {
      toast.error(errorParts(err).message);
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
            {phase === "listening" ? "Mendengarkan rekaman..." : "AI menghitung kalori..."}
          </p>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Biasanya 2 sampai 6 detik.</p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-3"
          onClick={() => {
            abortRef.current?.abort();
            setPhase("input");
          }}
        >
          Batalkan
        </Button>
      </div>
    );
  }

  if (phase === "review") {
    const today = jakartaToday();
    const order = (item: StoryFoodItem) => `${item.date}-${MEALS.indexOf(item.meal)}`;
    const indexed = items.map((item, index) => ({ item, index }));
    const groups = [...new Set(indexed.map(({ item }) => order(item)))]
      .sort()
      .map((key) => indexed.filter(({ item }) => order(item) === key));
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-muted px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground">Kamu bilang</p>
          <p className="mt-0.5 text-sm">{transcript}</p>
          <button
            type="button"
            onClick={backToInput}
            disabled={saving}
            className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            Ubah cerita
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
                        {[item.portion, item.grams != null ? `± ${fmtInt(item.grams)} g` : null]
                          .filter(Boolean)
                          .join(" · ") || "1 porsi"}
                      </span>
                    </span>
                    <Input
                      aria-label={`Kalori ${item.name}`}
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
                    <span className="text-xs font-semibold text-muted-foreground">kcal</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Hapus ${item.name}`}
                      onClick={() => remove(index)}
                      disabled={saving}
                      className="size-11 shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-semibold text-muted-foreground">Total</span>
          <span className="text-lg font-extrabold tabular-nums">
            {fmtInt(total)}{" "}
            <span className="text-xs font-semibold text-muted-foreground">kcal</span>
          </span>
        </div>
        <Button className="w-full" size="lg" onClick={() => void saveAll()} disabled={saving}>
          {saving ? "Menyimpan..." : `Simpan ${items.length} makanan`}
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
          setError("Tulis dulu makanannya, misalnya: nasi goreng 1 piring.");
          return;
        }
        void describe({ text: clean });
      }}
      className="space-y-3"
    >
      <label htmlFor="cerita-text" className="sr-only">
        Ceritakan makananmu
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
            Merekam {fmtClock(elapsed)}
          </span>
          <span className="text-xs text-muted-foreground">
            Sebut makanan, porsi, dan waktunya. Maksimal 1 menit.
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
              ? "Contoh: mie gacoan 1 porsi, udang keju 3 pcs"
              : "Contoh: kemarin pagi nasi kuning pakai telur dadar, siang nasi padang lauk rendang"
          }
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "cerita-error" : undefined}
          className="min-h-28 rounded-xl border-transparent bg-muted px-4 py-3 text-base md:text-base focus-visible:border-ring/60 focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/25"
        />
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
                Batal
              </Button>
              <Button type="button" className="flex-1" onClick={() => stopRecording(false)}>
                <Square className="size-4" aria-hidden />
                Selesai
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="Rekam suara"
              onClick={() => void startRecording()}
              className="size-12 shrink-0 rounded-full"
            >
              <Mic className="size-5" />
            </Button>
          ))}
        {!recording && (
          <Button type="submit" className="flex-1">
            Hitung kalori
          </Button>
        )}
      </div>
    </form>
  );
}
