import { Camera, Check, ChevronLeft, ScanBarcode, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { MEAL_LABELS, effectiveRamadan, jakartaToday, slotsFor, suggestMealNow } from "@joyorogo/api/lib/engine";
import { eatenAtClock, eatenAtFromClock } from "@joyorogo/api/lib/eaten-at";
import type { Meal } from "@joyorogo/api/lib/engine";
import { normalizeBarcode } from "@joyorogo/api/lib/barcode";
import { MAX_GRAMS, portionFromGrams } from "@joyorogo/api/lib/portion";
import { foodKind } from "@joyorogo/api/lib/food-kind";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { cn } from "@joyorogo/ui/lib/utils";
import { Card, FieldLabel, Page, PageHeader, Segmented } from "@/components/kit/surface";
import { MacroLine } from "@/components/macro-line";
import { EatenAtField } from "@/components/plate/eaten-at-field";
import { fmtInt, fmtKcalLabel, parseNum } from "@/lib/format";
import { FoodSafetyNotes } from "@/components/maternal/food-safety-notes";
import { KindPicker, SnackAdviceCard, useSnackAdvice } from "@/components/makan/snack-advice";
import type { PickableKind } from "@/components/makan/snack-advice";
import { client, orpc } from "@/utils/orpc";
import { LabelFlow, LabelThanks } from "@/components/makan/label-flow";
import type { ContributeResult } from "@/components/makan/label-flow";
import { fmtNumber } from "@joyorogo/i18n";

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

/** Collapsed-by-default explanation, so screenshots stay about the data. */
function Notes({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer px-1 font-semibold select-none">{summary}</summary>
      <div className="mt-1.5 space-y-1.5 px-1">{children}</div>
    </details>
  );
}

/** Live camera feed polled by BarcodeDetector; reports the first code it reads. */
function CameraScanner({ onCode, onClose }: { onCode: (raw: string) => void; onClose: () => void }) {
  const { t } = useTranslation(["barcode", "common"]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [error, setError] = useState<"denied" | "failed" | null>(null);

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
        setError(err instanceof DOMException && err.name === "NotAllowedError" ? "denied" : "failed");
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
    <Card className="space-y-3 p-3">
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label={t("camera.preview")}
          className="aspect-[4/3] w-full object-cover"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-[10%] top-1/2 h-24 -translate-y-1/2 rounded-2xl border-[3px] border-white/85"
        />
      </div>
      {error ? (
        <p role="alert" className="px-1 text-sm text-destructive">
          {t(`camera.error.${error}`)}
        </p>
      ) : (
        <>
          <p className="px-1 text-sm text-muted-foreground">{t("camera.aim")}</p>
          <Notes summary={t("camera.notes")}>
            <p>{t("camera.privacyWeb")}</p>
          </Notes>
        </>
      )}
      <Button variant="secondary" className="w-full" onClick={onClose}>
        <X className="size-4" aria-hidden />
        {t("camera.close")}
      </Button>
    </Card>
  );
}

function BarcodePage() {
  const { t } = useTranslation(["barcode", "common"]);
  const { date, meal: startMeal } = Route.useSearch();
  const [code, setCode] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const cameraSupported = barcodeDetector() !== null;

  const accept = (raw: string) => {
    const normalized = normalizeBarcode(raw);
    if (!normalized) {
      setCodeError(t("entry.invalid"));
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
        title={t("page.title")}
        subtitle={t("page.subtitle")}
        action={
          <Link to="/makan" search={date ? { date } : {}}>
            <Button variant="ghost" size="sm">
              <ChevronLeft className="size-4" aria-hidden />
              {t("common:actions.back")}
            </Button>
          </Link>
        }
      />
      {code === null ? (
        <div className="space-y-3">
          {cameraOn ? (
            <CameraScanner onCode={accept} onClose={() => setCameraOn(false)} />
          ) : (
            <Card className="space-y-2">
              {cameraSupported ? (
                <Button className="w-full" onClick={() => setCameraOn(true)}>
                  <Camera className="size-4" aria-hidden />
                  {t("camera.open")}
                </Button>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">{t("camera.unsupported")}</p>
                  <Notes summary={t("camera.notes")}>
                    <p>{t("camera.unsupportedDetail")}</p>
                  </Notes>
                </>
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
              <FieldLabel htmlFor="barcode-number">{t("entry.number")}</FieldLabel>
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
                {t("entry.search")}
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
  const { t } = useTranslation(["barcode", "common"]);
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
  // Optional "Jam makan" (unix ms); null = now, nothing is sent.
  const [eatenAt, setEatenAt] = useState<number | null>(null);
  const [grams, setGrams] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualKcal, setManualKcal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [kindOverride, setKindOverride] = useState<PickableKind | null>(null);
  const [halfUndo, setHalfUndo] = useState<{ field: "grams" | "kcal"; value: string } | null>(null);
  const [labelOpen, setLabelOpen] = useState(false);
  const [thanks, setThanks] = useState<{
    outcome: ContributeResult["outcome"];
    contributors: number;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [communityDone, setCommunityDone] = useState(false);
  // The cutout of the pack photo the person chose to keep in the label flow (opt-in); it becomes the logged meal's sticker.
  const [keptSticker, setKeptSticker] = useState<string | null>(null);
  const foundRef = useRef<HTMLElement>(null);

  const save = async (input: Parameters<typeof client.food.add>[0]) => {
    setSaving(true);
    setError(null);
    try {
      await client.food.add({
        ...input,
        date,
        meal,
        ...(eatenAt !== null
          ? { eatenAt: eatenAtFromClock(date ?? jakartaToday(), eatenAtClock(eatenAt)) ?? undefined }
          : {}),
      });
      toast.success(t("save.toast", { name: input.name, meal: MEAL_LABELS[meal] }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.food.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.day.key() }),
      ]);
      void navigate({ to: "/makan", search: date ? { date } : {} });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("save.failed"));
    } finally {
      setSaving(false);
    }
  };

  // The server answers contribute/confirm with the product as everyone sees it
  // now; writing it under the lookup key makes the found UI render it at once.
  const applyResult = (result: ContributeResult) => {
    queryClient.setQueryData(orpc.barcode.lookup.queryOptions({ input: { code } }).queryKey, result.lookup);
    setCommunityDone(true);
    setGrams(null);
  };

  const confirmCommunity = async () => {
    setConfirming(true);
    try {
      const result = await client.barcode.confirm({ code });
      applyResult(result);
      toast.success(
        result.outcome === "outvoted"
          ? t("result.community.outvoted")
          : t("result.community.confirmed", { count: result.contributors }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("save.failed"));
    } finally {
      setConfirming(false);
    }
  };

  const continueToLog = () => {
    const el = foundRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  };

  const mealPicker = meals.length > 1 && (
    <Segmented
      label={t("meal.label")}
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
    <div className="space-y-2">
      <Button className="w-full" onClick={() => setLabelOpen(true)}>
        <Camera className="size-4" aria-hidden />
        {t("fallback.label")}
      </Button>
      <Notes summary={t("label.title")}>
        <p>{t("fallback.labelNote")}</p>
      </Notes>
      <Link to="/makan/ai" search={date ? { date } : {}}>
        <Button variant="secondary" className="w-full">
          <Camera className="size-4" aria-hidden />
          {t("fallback.photo")}
        </Button>
      </Link>
      <Notes summary={t("fallback.notes")}>
        <p>{t("fallback.photoNote")}</p>
      </Notes>
      {manualOpen ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const name = manualName.trim();
            const kcal = parseNum(manualKcal);
            if (name === "") return setError(t("manual.nameRequired"));
            if (kcal === null || kcal < 0) return setError(t("manual.kcalRequired"));
            void save({ meal, name, kcal, source: "manual" });
          }}
        >
          <div>
            <FieldLabel htmlFor="barcode-manual-name">{t("manual.name")}</FieldLabel>
            <Input
              id="barcode-manual-name"
              value={manualName}
              onChange={(event) => setManualName(event.target.value)}
              placeholder={t("manual.namePlaceholder")}
            />
          </div>
          <div>
            <FieldLabel htmlFor="barcode-manual-kcal">{t("manual.kcal")}</FieldLabel>
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
          <EatenAtField id="barcode-eaten-at" date={date ?? jakartaToday()} value={eatenAt} onChange={setEatenAt} />
          <KindPicker value={kind} onChange={setKindOverride} />
          <SnackAdviceCard
            state={advice}
            onHalf={halve}
            halfApplied={halfUndo !== null}
            onUndoHalf={undoHalf}
          />
          <FoodSafetyNotes names={adviceName ? [adviceName] : []} date={date} addToDay />
          {error && (
            <p role="alert" className="px-1 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? t("save.saving") : t("save.button")}
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
          {t("fallback.manual")}
        </Button>
      )}
      <Button variant="ghost" className="w-full" onClick={onReset}>
        {t("fallback.scanAnother")}
      </Button>
    </div>
  );

  if (labelOpen) {
    return (
      <LabelFlow
        code={code}
        known={product ?? undefined}
        onCancel={() => setLabelOpen(false)}
        onSaved={(result, stickerScanId) => {
          applyResult(result);
          setKeptSticker(stickerScanId);
          setThanks({ outcome: result.outcome, contributors: result.contributors });
          setLabelOpen(false);
        }}
      />
    );
  }

  if (lookup.isPending) {
    return (
      <Card role="status" className="text-center text-sm text-muted-foreground">
        {t("lookup.searching", { code })}
      </Card>
    );
  }
  if (lookup.isError || !data) {
    return (
      <Card className="space-y-3">
        <h2 className="text-lg font-bold">{t("lookup.failed.title")}</h2>
        <p role="alert" className="text-sm text-muted-foreground">
          {lookup.error?.message ?? t("lookup.failed.fallback")}
        </p>
        <Button className="w-full" onClick={() => void lookup.refetch()}>
          {t("common:actions.retry")}
        </Button>
        {fallback}
      </Card>
    );
  }
  if (data.status === "not_found") {
    return (
      <Card className="space-y-3">
        <h2 className="text-lg font-bold">{t("lookup.notFound.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("lookup.notFound.body", { code: data.code })}
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
          {t("lookup.incomplete.body", { reason: t(`lookup.incomplete.reason.${data.reason}`) })}
        </p>
        {fallback}
      </Card>
    );
  }

  const { per100, perServing, servingSize, missing } = data;
  const unit = data.product.unit;
  const servingLabel = servingSize ? `${fmtInt(servingSize)} ${unit}` : "";

  const sourceLine =
    data.source === "off"
      ? t("result.sources.off")
      : data.source === "label_photo"
        ? data.contributors >= 2
          ? t("result.sources.labelPhotoConfirmed", { count: data.contributors })
          : t("result.sources.labelPhoto")
        : data.source === "usda"
          ? t("result.sources.usda")
          : t("result.sources.other", { source: data.source });

  const foundCard = (
    <Card ref={foundRef} tabIndex={-1} className="space-y-3 outline-none">
      <div className="flex items-center gap-3">
        {data.product.imageUrl ? (
          <img
            src={data.product.imageUrl}
            alt=""
            className="size-14 shrink-0 rounded-xl bg-muted object-contain"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-muted"
          >
            <ScanBarcode className="size-6 text-muted-foreground" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-lg leading-tight font-bold">{data.product.name}</h2>
          <p className="text-sm text-muted-foreground">
            {[data.product.brand, data.product.quantity].filter(Boolean).join(" · ") ||
              t("result.unknownProduct", { code: data.code })}
          </p>
        </div>
      </div>

      {data.source === "label_photo" && data.mine !== true && !communityDone && (
        <div className="space-y-2 rounded-2xl bg-muted/60 p-4">
          <p className="text-sm font-semibold">{t("result.community.prompt")}</p>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={confirming} onClick={() => void confirmCommunity()}>
              {confirming ? t("result.community.confirming") : t("result.community.confirm")}
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              disabled={confirming}
              onClick={() => setLabelOpen(true)}
            >
              {t("result.community.wrong")}
            </Button>
          </div>
        </div>
      )}

      <dl className={cn("grid gap-3 text-sm", perServing && servingSize && "grid-cols-2")}>
        <div>
          <dt className="font-semibold text-muted-foreground">{t("result.per100", { unit })}</dt>
          <dd className="text-lg font-extrabold tabular-nums">{fmtKcalLabel(per100.kcal)}</dd>
          <dd>
            <MacroLine
              className="text-xs text-muted-foreground"
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
              {t("result.perServing", { size: servingLabel })}
            </dt>
            <dd className="text-lg font-extrabold tabular-nums">{fmtKcalLabel(perServing.kcal)}</dd>
            <dd>
              <MacroLine
                className="text-xs text-muted-foreground"
                protein={perServing.protein}
                carbs={perServing.carbs}
                fat={perServing.fat}
                fiber={perServing.fiber}
              />
            </dd>
          </div>
        ) : null}
      </dl>
      {data.sugar100 !== null && (
        <p className="text-sm text-muted-foreground">
          {t("result.sugar", { value: fmtNumber(data.sugar100, 1), unit })}
        </p>
      )}

      <div>
        <FieldLabel htmlFor="barcode-grams">{t("quantity.label", { unit })}</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id="barcode-grams"
            className="w-24 shrink-0"
            inputMode="decimal"
            value={gramsText}
            onChange={(event) => setGrams(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {servingSize ? (
              <PortionChip
                active={gramsNum === servingSize}
                onClick={() => setGrams(String(servingSize))}
              >
                {t("quantity.serving", { size: servingLabel })}
              </PortionChip>
            ) : null}
            <PortionChip active={gramsNum === 100} onClick={() => setGrams("100")}>
              {t("quantity.hundred", { unit })}
            </PortionChip>
          </div>
        </div>
      </div>

      {scaled ? (
        <div className="text-center">
          <p className="text-sm font-semibold text-muted-foreground">{t("total.label")}</p>
          <p className="text-3xl font-extrabold tracking-tight tabular-nums">
            {fmtKcalLabel(scaled.kcal)}
          </p>
          <MacroLine
            className="mt-0.5 justify-center text-sm text-muted-foreground"
            protein={scaled.protein}
            carbs={scaled.carbs}
            fat={scaled.fat}
            fiber={scaled.fiber}
          />
        </div>
      ) : (
        <p role="alert" className="text-center text-sm text-destructive">
          {t("quantity.range", { max: MAX_GRAMS, unit })}
        </p>
      )}

      {mealPicker}
      <EatenAtField id="barcode-eaten-at-manual" date={date ?? jakartaToday()} value={eatenAt} onChange={setEatenAt} />
      <KindPicker value={kind} onChange={setKindOverride} />
      <SnackAdviceCard
        state={advice}
        onHalf={halve}
        halfApplied={halfUndo !== null}
        onUndoHalf={undoHalf}
      />
      <FoodSafetyNotes names={adviceName ? [adviceName] : []} date={date} addToDay />
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
            scanId: keptSticker ?? undefined,
            itemsJson: JSON.stringify({
              barcode: data.code,
              brand: data.product.brand,
              source: data.source,
            }),
          });
        }}
      >
        <Check className="size-4" aria-hidden />
        {saving ? t("save.saving") : t("save.buttonTo", { meal: MEAL_LABELS[meal] })}
      </Button>
      <Button variant="ghost" className="w-full" onClick={onReset}>
        {t("fallback.scanAnother")}
      </Button>
      <Notes summary={t("result.notes")}>
        {missing.length > 0 && (
          <p>
            {t("result.missing", { fields: missing.map((key) => t(`macro.${key}`)).join(", ") })}
          </p>
        )}
        <p>{sourceLine}</p>
        {data.source === "off" && (
          <p>
            <a
              href={`https://world.openfoodfacts.org/product/${data.code}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline underline-offset-2"
            >
              {t("result.sources.offLink")}
            </a>
          </p>
        )}
      </Notes>
    </Card>
  );

  return thanks ? (
    <div className="space-y-3">
      <LabelThanks
        outcome={thanks.outcome}
        contributors={thanks.contributors}
        onContinue={continueToLog}
      />
      {foundCard}
    </div>
  ) : (
    foundCard
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
