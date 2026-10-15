import { Camera, Check, ChevronLeft, ScanBarcode, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { MEAL_LABELS, effectiveRamadan, slotsFor, suggestMealNow } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { normalizeBarcode } from "@joyorogo/api/lib/barcode";
import { MAX_GRAMS, portionFromGrams } from "@joyorogo/api/lib/portion";
import { foodKind } from "@joyorogo/api/lib/food-kind";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { cn } from "@joyorogo/ui/lib/utils";
import { Card, FieldLabel, Page, PageHeader, Segmented } from "@/components/kit/surface";
import { MacroLine } from "@/components/macro-line";
import { fmtInt, parseNum } from "@/lib/format";
import { KindPicker, SnackAdviceCard, useSnackAdvice } from "@/components/makan/snack-advice";
import type { PickableKind } from "@/components/makan/snack-advice";
import { client, orpc } from "@/utils/orpc";

const MEAL_KEYS = Object.keys(MEAL_LABELS) as Meal[];

export const Route = createFileRoute("/_auth/makan/barcode")({
  // The makan page forwards its DaySwitcher day and the tapped slot, so the
  // scan lands where the user was looking.
  validateSearch: (search: Record<string, unknown>): { date?: string; meal?: Meal } => {
    const date = typeof search.date === "string" ? search.date : undefined;
    const meal = MEAL_KEYS.find((key) => key === search.meal);
    return { date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined, meal };
  },
  component: BarcodePage,
});

const MACRO_NAMES = { protein: "protein", carbs: "karbo", fat: "lemak", fiber: "serat" } as const;

// BarcodeDetector ships in Chromium (Android, ChromeOS, macOS) but is missing
// from Firefox, Safari and desktop Chrome on Linux/Windows, and from lib.dom.
type DetectorInstance = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
type DetectorCtor = new (options?: { formats?: string[] }) => DetectorInstance;

function barcodeDetector(): DetectorCtor | null {
  if (typeof window === "undefined" || !("BarcodeDetector" in window)) return null;
  // lib.dom has no BarcodeDetector; the `in` check above proves it exists.
  const detector = window.BarcodeDetector as DetectorCtor;
  return detector;
}

/** Live camera feed polled by BarcodeDetector; reports the first code it reads. */
function CameraScanner({ onCode, onClose }: { onCode: (raw: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    let stream: MediaStream | null = null;
    const start = async () => {
      const Detector = barcodeDetector();
      if (!Detector) return;
      try {
        const detector = new Detector({ formats: ["ean_13", "ean_8", "upc_a"] });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        const video = videoRef.current;
        if (stopped || !video) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (stopped) return;
          try {
            const value = (await detector.detect(video))[0]?.rawValue;
            if (value) {
              onCodeRef.current(value);
            }
          } catch {
            // a dropped frame is fine; the next tick retries
          }
          if (!stopped) timer = window.setTimeout(tick, 250);
        };
        void tick();
      } catch (err) {
        setError(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Izin kamera ditolak. Izinkan kamera di pengaturan browser, atau ketik nomornya."
            : "Kamera tidak bisa dibuka. Ketik nomor barcode di bawah.",
        );
      }
    };
    void start();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <Card className="p-3">
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label="Pratinjau kamera untuk membaca barcode"
          className="aspect-[4/3] w-full object-cover"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-[10%] top-1/2 h-24 -translate-y-1/2 rounded-2xl border-[3px] border-white/85"
        />
      </div>
      {error ? (
        <p role="alert" className="mt-3 px-1 text-sm text-destructive">
          {error}
        </p>
      ) : (
        <p className="mt-3 px-1 text-sm text-muted-foreground">
          Arahkan kamera ke barcode di kemasan. Gambar diproses di browsermu dan tidak dikirim.
        </p>
      )}
      <Button variant="secondary" className="mt-3 w-full" onClick={onClose}>
        <X className="size-4" aria-hidden />
        Tutup kamera
      </Button>
    </Card>
  );
}

function BarcodePage() {
  const { date, meal: startMeal } = Route.useSearch();
  const [code, setCode] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const cameraSupported = barcodeDetector() !== null;

  const accept = (raw: string) => {
    const normalized = normalizeBarcode(raw);
    if (!normalized) {
      setCodeError("Nomor barcode tidak valid. Cek lagi angkanya (8, 12, atau 13 digit).");
      return;
    }
    setCodeError(null);
    setCameraOn(false);
    setCode(normalized);
  };

  const reset = () => {
    setCode(null);
    setTyped("");
    setCodeError(null);
  };

  return (
    <Page className="md:max-w-3xl">
      <PageHeader
        title="Pindai barcode"
        subtitle="Angka gizi kemasan dari Open Food Facts."
        action={
          <Link to="/makan" search={date ? { date } : {}}>
            <Button variant="ghost" size="sm">
              <ChevronLeft className="size-4" aria-hidden />
              Kembali
            </Button>
          </Link>
        }
      />
      {code === null ? (
        <div className="space-y-3">
          {cameraOn ? (
            <CameraScanner onCode={accept} onClose={() => setCameraOn(false)} />
          ) : (
            <Card>
              {cameraSupported ? (
                <Button className="w-full" onClick={() => setCameraOn(true)}>
                  <Camera className="size-4" aria-hidden />
                  Buka kamera
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Browser ini belum bisa membaca barcode lewat kamera (didukung Chrome di Android).
                  Ketik nomor yang tertera di bawah barcode, atau pakai aplikasi JoyoRogo di HP.
                </p>
              )}
            </Card>
          )}
          <Card>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                accept(typed);
              }}
            >
              <FieldLabel htmlFor="barcode-number">Nomor barcode</FieldLabel>
              <Input
                id="barcode-number"
                inputMode="numeric"
                autoComplete="off"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="8996001600146"
                maxLength={20}
              />
              {codeError && (
                <p role="alert" className="mt-2 px-1 text-sm text-destructive">
                  {codeError}
                </p>
              )}
              <Button type="submit" className="mt-3 w-full" disabled={typed.trim() === ""}>
                <ScanBarcode className="size-4" aria-hidden />
                Cari
              </Button>
            </form>
          </Card>
        </div>
      ) : (
        <BarcodeResult key={code} code={code} date={date} startMeal={startMeal} onReset={reset} />
      )}
    </Page>
  );
}

function BarcodeResult({
  code,
  date,
  startMeal,
  onReset,
}: {
  code: string;
  date?: string;
  startMeal?: Meal;
  onReset: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const lookup = useQuery({
    ...orpc.barcode.lookup.queryOptions({ input: { code } }),
    retry: false,
    staleTime: Infinity,
  });
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const ramadan = effectiveRamadan(profile.data?.profile?.ramadanMode);
  const meals = MEAL_KEYS.filter((key) => slotsFor(ramadan).includes(key));
  const [meal, setMeal] = useState<Meal>(startMeal ?? suggestMealNow(new Date(), ramadan));
  const [grams, setGrams] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualKcal, setManualKcal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [kindOverride, setKindOverride] = useState<PickableKind | null>(null);
  const [halfUndo, setHalfUndo] = useState<{ field: "grams" | "kcal"; value: string } | null>(null);

  const save = async (input: Parameters<typeof client.food.add>[0]) => {
    setSaving(true);
    setError(null);
    try {
      await client.food.add({ ...input, date, meal });
      toast.success(`${input.name} dicatat ke ${MEAL_LABELS[meal]}.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.food.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.day.key() }),
      ]);
      void navigate({ to: "/makan", search: date ? { date } : {} });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan. Coba lagi.");
    } finally {
      setSaving(false);
    }
  };

  const mealPicker = meals.length > 1 && (
    <Segmented
      label="Waktu makan"
      value={meal}
      onChange={setMeal}
      options={meals.map((key) => ({ value: key, label: MEAL_LABELS[key] }))}
    />
  );

  const data = lookup.data;
  const product = data && data.status !== "not_found" ? data.product : null;

  const okData = data && data.status !== "not_found" && data.status !== "incomplete" ? data : null;
  const gramsText = grams ?? String(okData?.servingSize ?? 100);
  const gramsNum = parseNum(gramsText);
  const gramsOk = gramsNum !== null && gramsNum >= 1 && gramsNum <= MAX_GRAMS;
  const scaled = okData && gramsOk ? portionFromGrams(okData.per100, gramsNum) : null;
  const manualKcalNum = parseNum(manualKcal);
  const adviceName = (manualOpen ? manualName.trim() : product?.name) || undefined;
  const kind = kindOverride ?? foodKind(adviceName ?? "");
  const adviceKcal = manualOpen ? (manualKcalNum ?? 0) : (scaled?.kcal ?? 0);
  const advice = useSnackAdvice({ date, kcal: adviceKcal, kind, slot: meal, name: adviceName });

  // "Setengah porsi" rescales the field the screen is already using (grams or
  // typed kcal); the previous text is kept so one tap brings the full portion back.
  const halve = () => {
    if (manualOpen) {
      if (manualKcalNum === null) return;
      setHalfUndo({ field: "kcal", value: manualKcal });
      setManualKcal(String(Math.round(manualKcalNum / 2)));
      return;
    }
    if (gramsNum === null) return;
    setHalfUndo({ field: "grams", value: gramsText });
    setGrams(String(Math.max(1, Math.round(gramsNum / 2))));
  };
  const undoHalf = () => {
    if (!halfUndo) return;
    if (halfUndo.field === "kcal") setManualKcal(halfUndo.value);
    else setGrams(halfUndo.value);
    setHalfUndo(null);
  };

  const fallback = (
    <div className="space-y-3">
      <Link to="/makan/ai" search={date ? { date } : {}}>
        <Button className="w-full">
          <Camera className="size-4" aria-hidden />
          Foto produknya, AI perkirakan
        </Button>
      </Link>
      <p className="px-1 text-xs text-muted-foreground">
        AI memperkirakan dari foto, bukan membaca angka di label. Kalau kamu punya angka dari
        label, isi sendiri.
      </p>
      {manualOpen ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const name = manualName.trim();
            const kcal = parseNum(manualKcal);
            if (name === "") return setError("Isi dulu nama makanannya.");
            if (kcal === null || kcal < 0) return setError("Isi jumlah kalorinya, contoh: 350.");
            void save({ meal, name, kcal, source: "manual" });
          }}
        >
          <div>
            <FieldLabel htmlFor="barcode-manual-name">Nama makanan</FieldLabel>
            <Input
              id="barcode-manual-name"
              value={manualName}
              onChange={(event) => setManualName(event.target.value)}
              placeholder="Nama produk"
            />
          </div>
          <div>
            <FieldLabel htmlFor="barcode-manual-kcal">Kalori (kcal)</FieldLabel>
            <Input
              id="barcode-manual-kcal"
              type="number"
              min="0"
              inputMode="numeric"
              value={manualKcal}
              onChange={(event) => setManualKcal(event.target.value)}
              placeholder="350"
            />
          </div>
          {mealPicker}
          <KindPicker value={kind} onChange={setKindOverride} />
          <SnackAdviceCard
            state={advice}
            onHalf={halve}
            halfApplied={halfUndo !== null}
            onUndoHalf={undoHalf}
          />
          {error && (
            <p role="alert" className="px-1 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? "Menyimpan..." : "Catat"}
          </Button>
        </form>
      ) : (
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => {
            setManualName(product?.name ?? "");
            setManualOpen(true);
          }}
        >
          Isi kalori sendiri
        </Button>
      )}
      <Button variant="ghost" className="w-full" onClick={onReset}>
        Pindai barcode lain
      </Button>
    </div>
  );

  if (lookup.isPending) {
    return (
      <Card role="status" className="text-center text-sm text-muted-foreground">
        Mencari {code} di Open Food Facts…
      </Card>
    );
  }
  if (lookup.isError || !data) {
    return (
      <Card className="space-y-3">
        <h2 className="text-lg font-bold">Pencarian gagal</h2>
        <p className="text-sm text-muted-foreground">
          {lookup.error?.message ?? "Open Food Facts tidak bisa dihubungi."}
        </p>
        <Button className="w-full" onClick={() => void lookup.refetch()}>
          Coba lagi
        </Button>
        {fallback}
      </Card>
    );
  }
  if (data.status === "not_found") {
    return (
      <Card className="space-y-3">
        <h2 className="text-lg font-bold">Produk belum ada di Open Food Facts</h2>
        <p className="text-sm text-muted-foreground">
          Barcode {data.code} belum terdaftar di basis data komunitas itu, jadi kami tidak punya
          angka gizinya. Kamu bisa foto produknya atau isi kalorinya sendiri.
        </p>
        {fallback}
      </Card>
    );
  }
  if (data.status === "incomplete") {
    return (
      <Card className="space-y-3">
        <h2 className="text-lg font-bold">{data.product.name}</h2>
        <p className="text-sm text-muted-foreground">
          {data.reason} Karena itu produk ini tidak kami catat otomatis. Kamu bisa foto produknya
          atau isi kalorinya sendiri dari label.
        </p>
        {fallback}
      </Card>
    );
  }

  const { per100, perServing, servingSize, missing } = data;
  const unit = data.product.unit;

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center gap-4">
          {data.product.imageUrl ? (
            <img
              src={data.product.imageUrl}
              alt=""
              className="size-[72px] shrink-0 rounded-2xl bg-muted object-contain"
            />
          ) : (
            <span
              aria-hidden
              className="flex size-[72px] shrink-0 items-center justify-center rounded-2xl bg-muted"
            >
              <ScanBarcode className="size-7 text-muted-foreground" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-bold">{data.product.name}</h2>
            <p className="text-sm text-muted-foreground">
              {[data.product.brand, data.product.quantity].filter(Boolean).join(" · ") ||
                `Barcode ${data.code}`}
            </p>
          </div>
        </div>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="font-semibold text-muted-foreground">Per 100 {unit}</dt>
            <dd className="text-xl font-extrabold tabular-nums">{fmtInt(per100.kcal)} kcal</dd>
            <dd>
              <MacroLine
                className="text-muted-foreground"
                protein={per100.protein}
                carbs={per100.carbs}
                fat={per100.fat}
                fiber={per100.fiber}
              />
            </dd>
          </div>
          {perServing && servingSize ? (
            <div>
              <dt className="font-semibold text-muted-foreground">
                Per sajian ({fmtInt(servingSize)} {unit})
              </dt>
              <dd className="text-xl font-extrabold tabular-nums">{fmtInt(perServing.kcal)} kcal</dd>
              <dd>
                <MacroLine
                  className="text-muted-foreground"
                  protein={perServing.protein}
                  carbs={perServing.carbs}
                  fat={perServing.fat}
                  fiber={perServing.fiber}
                />
              </dd>
            </div>
          ) : null}
        </dl>
        {missing.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Open Food Facts belum punya data {missing.map((key) => MACRO_NAMES[key]).join(", ")}{" "}
            untuk produk ini; yang kosong dicatat sebagai tidak diketahui, bukan nol.
          </p>
        )}
      </Card>

      <Card className="space-y-4">
        <div>
          <FieldLabel htmlFor="barcode-grams">Berapa banyak yang kamu makan ({unit})</FieldLabel>
          <Input
            id="barcode-grams"
            inputMode="decimal"
            value={gramsText}
            onChange={(event) => setGrams(event.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {servingSize ? (
              <PortionChip
                active={gramsNum === servingSize}
                onClick={() => setGrams(String(servingSize))}
              >
                1 sajian · {fmtInt(servingSize)} {unit}
              </PortionChip>
            ) : null}
            <PortionChip active={gramsNum === 100} onClick={() => setGrams("100")}>
              100 {unit}
            </PortionChip>
          </div>
        </div>

        {scaled ? (
          <div className="text-center">
            <p className="text-sm font-semibold text-muted-foreground">Yang dicatat</p>
            <p className="text-4xl font-extrabold tracking-tight tabular-nums">
              {fmtInt(scaled.kcal)} kcal
            </p>
            <MacroLine
              className="mt-1 justify-center text-sm text-muted-foreground"
              protein={scaled.protein}
              carbs={scaled.carbs}
              fat={scaled.fat}
              fiber={scaled.fiber}
            />
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            Isi takaran antara 1 dan {MAX_GRAMS} {unit}.
          </p>
        )}

        {mealPicker}
        <KindPicker value={kind} onChange={setKindOverride} />
        <SnackAdviceCard
          state={advice}
          onHalf={halve}
          halfApplied={halfUndo !== null}
          onUndoHalf={undoHalf}
        />
        {error && (
          <p role="alert" className="px-1 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          className="w-full"
          disabled={!scaled || saving}
          onClick={() => {
            if (!scaled) return;
            void save({
              meal,
              name: data.product.name,
              grams: scaled.grams ?? undefined,
              kcal: scaled.kcal,
              protein: scaled.protein ?? undefined,
              carbs: scaled.carbs ?? undefined,
              fat: scaled.fat ?? undefined,
              fiber: scaled.fiber ?? undefined,
              source: "barcode",
              itemsJson: JSON.stringify({
                barcode: data.code,
                brand: data.product.brand,
                source: "openfoodfacts",
              }),
            });
          }}
        >
          <Check className="size-4" aria-hidden />
          {saving ? "Menyimpan..." : `Catat ke ${MEAL_LABELS[meal]}`}
        </Button>
        <Button variant="ghost" className="w-full" onClick={onReset}>
          Pindai barcode lain
        </Button>
        <p className="px-1 text-xs text-muted-foreground">
          Sumber: Open Food Facts, basis data komunitas. Angkanya bisa beda dari label kemasanmu;
          cek lagi kalau ragu.
        </p>
      </Card>
    </div>
  );
}

function PortionChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-10 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        active ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-border",
      )}
    >
      {children}
    </button>
  );
}
