import { Camera, Check, ImagePlus, Loader2, TriangleAlert } from "lucide-react";
import { ORPCError } from "@orpc/client";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { checkPer100, toPer100 } from "@joyorogo/api/lib/barcode-nutrition";
import type {
  LabelBasis,
  LabelDraft,
  LabelNutrients,
  LabelUnit,
} from "@joyorogo/api/lib/barcode-nutrition";
import type { ContributeResponse } from "@joyorogo/api/routers/barcode";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { cn } from "@joyorogo/ui/lib/utils";
import { Card, FieldLabel, Segmented } from "@/components/kit/surface";
import { fmtInt, parseNum } from "@/lib/format";
import { prepareImageFile } from "@/lib/image";
import { client } from "@/utils/orpc";

/** Longest photo side sent for reading; the panel's small print stays legible at this size. */
const LABEL_MAX_SIDE = 1280;

/** What `barcode.contribute` / `barcode.confirm` return. */
export type ContributeResult = ContributeResponse;

/** What the lookup already knows about the product, to prefill what the photo did not give. */
export type KnownProduct = {
  name: string;
  brand: string | null;
  quantity: string | null;
  unit: LabelUnit;
};

type Slot = "label" | "front";
type Photo = { file: File; url: string };
type Step = "capture" | "reading" | "form";

// ---------------------------------------------------------------------------
// Flow: capture -> reading -> form. The parent shows <LabelThanks/> afterwards.
// ---------------------------------------------------------------------------

export function LabelFlow({
  code,
  known,
  onCancel,
  onSaved,
}: {
  code: string;
  known?: KnownProduct;
  onCancel: () => void;
  onSaved: (result: ContributeResult) => void;
}) {
  const { t } = useTranslation(["barcode", "common"]);
  const [step, setStep] = useState<Step>("capture");
  const [photos, setPhotos] = useState<Record<Slot, Photo | null>>({ label: null, front: null });
  const [readError, setReadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<LabelDraft | null>(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const rootRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  useEffect(
    () => () => {
      for (const photo of Object.values(photosRef.current)) {
        if (photo) URL.revokeObjectURL(photo.url);
      }
    },
    [],
  );

  // Each step swaps the card's content; move focus to it so keyboard and screen
  // reader users land on the new step instead of a vanished button.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    rootRef.current?.focus();
  }, [step]);

  const setPhoto = (slot: Slot, file: File | null) => {
    const old = photosRef.current[slot];
    if (old) URL.revokeObjectURL(old.url);
    setPhotos((prev) => ({ ...prev, [slot]: file ? { file, url: URL.createObjectURL(file) } : null }));
    setReadError(null);
  };

  const read = async () => {
    const label = photos.label;
    if (!label) return;
    const front = photos.front;
    setStep("reading");
    setReadError(null);
    try {
      const [labelImage, frontImage] = await Promise.all([
        prepareImageFile(label.file, LABEL_MAX_SIDE),
        front ? prepareImageFile(front.file, LABEL_MAX_SIDE) : null,
      ]);
      const result = await client.barcode.readLabel({
        code,
        label: { imageBase64: labelImage.base64, mimeType: labelImage.mimeType },
        front: frontImage
          ? { imageBase64: frontImage.base64, mimeType: frontImage.mimeType }
          : undefined,
      });
      setDraft(result.draft);
      setStep("form");
    } catch (err) {
      setReadError(err instanceof ORPCError ? err.message : t("errors.labelFailed"));
      setStep("capture");
    }
  };

  const manual = () => {
    setDraft(null);
    setStep("form");
  };

  return (
    <div ref={rootRef} tabIndex={-1} className="outline-none">
      {step === "reading" && (
        <Card role="status" className="flex items-center justify-center gap-3 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          {t("label.capture.reading")}
        </Card>
      )}
      {step === "capture" && (
        <Card className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold">{t("label.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("label.intro")}</p>
            <p className="text-xs text-muted-foreground">{t("label.privacy")}</p>
          </div>
          <PhotoSlot
            title={t("label.capture.label")}
            what={t("label.capture.labelWhat")}
            hint={t("label.capture.labelHint")}
            photo={photos.label}
            onPick={(file) => setPhoto("label", file)}
          />
          <PhotoSlot
            title={t("label.capture.front")}
            what={t("label.capture.frontWhat")}
            hint={t("label.capture.frontHint")}
            photo={photos.front}
            onPick={(file) => setPhoto("front", file)}
          />
          {readError && (
            <p role="alert" className="px-1 text-sm text-destructive">
              {readError}
            </p>
          )}
          <div className="space-y-2">
            <Button
              className="w-full"
              disabled={!photos.label}
              aria-describedby={photos.label ? undefined : "label-need-photo"}
              onClick={() => void read()}
            >
              {t("label.capture.read")}
            </Button>
            {!photos.label && (
              <p id="label-need-photo" className="px-1 text-center text-xs text-muted-foreground">
                {t("label.capture.needLabel")}
              </p>
            )}
            <Button variant="secondary" className="w-full" onClick={manual}>
              {t("label.capture.manual")}
            </Button>
            <Button variant="ghost" className="w-full" onClick={onCancel}>
              {t("common:actions.cancel")}
            </Button>
          </div>
        </Card>
      )}
      {step === "form" && (
        <LabelForm
          code={code}
          draft={draft}
          known={known}
          onBack={() => setStep("capture")}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

/** One photo slot: take / choose from gallery, then thumbnail with retake / remove. */
function PhotoSlot({
  title,
  what,
  hint,
  photo,
  onPick,
}: {
  title: string;
  what: string;
  hint: string;
  photo: Photo | null;
  onPick: (file: File | null) => void;
}) {
  const { t } = useTranslation("barcode");
  const titleId = useId();
  const takeRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLInputElement>(null);

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (file) onPick(file);
  };

  return (
    <div role="group" aria-labelledby={titleId} className="space-y-2">
      <div>
        <p id={titleId} className="text-sm font-semibold">
          {title}
        </p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex items-center gap-3">
        {photo && (
          <img
            src={photo.url}
            alt={t("label.capture.photoAlt", { what })}
            className="size-20 shrink-0 rounded-xl bg-muted object-cover"
          />
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => takeRef.current?.click()}>
            <Camera aria-hidden />
            {photo ? t("label.capture.retake") : t("label.capture.take")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => chooseRef.current?.click()}>
            <ImagePlus aria-hidden />
            {t("label.capture.choose")}
          </Button>
          {photo && (
            <Button variant="ghost" size="sm" onClick={() => onPick(null)}>
              {t("label.capture.remove")}
            </Button>
          )}
        </div>
      </div>
      <input
        ref={takeRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={onChange}
      />
      <input
        ref={chooseRef}
        type="file"
        accept="image/*"
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={onChange}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm form
// ---------------------------------------------------------------------------

type Fields = {
  name: string;
  brand: string;
  quantity: string;
  serving: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
  sugar: string;
};

const NUTRIENT_KEYS = ["kcal", "protein", "carbs", "fat", "fiber", "sugar"] as const;
type NutrientKey = (typeof NUTRIENT_KEYS)[number];

// Same bounds the server enforces (barcode.contribute).
const NUTRIENT_MAX: Record<NutrientKey, number> = {
  kcal: 5000,
  protein: 1000,
  carbs: 1000,
  fat: 1000,
  fiber: 1000,
  sugar: 1000,
};
const SERVING_MAX = 5000;

const text = (n: number | null) => (n === null ? "" : String(n));

/** Blank = not given; typed but non-numeric or out of range = invalid. */
function readNum(value: string, max: number): { value: number | null; invalid: boolean } {
  if (value.trim() === "") return { value: null, invalid: false };
  const n = parseNum(value);
  if (n === null || n < 0 || n > max) return { value: null, invalid: true };
  return { value: n, invalid: false };
}

function initialFields(draft: LabelDraft | null, known: KnownProduct | undefined): Fields {
  return {
    name: draft?.name ?? known?.name ?? "",
    brand: draft?.brand ?? known?.brand ?? "",
    quantity: draft?.quantity ?? known?.quantity ?? "",
    serving: text(draft?.servingSize ?? null),
    kcal: text(draft?.nutrients.kcal ?? null),
    protein: text(draft?.nutrients.protein ?? null),
    carbs: text(draft?.nutrients.carbs ?? null),
    fat: text(draft?.nutrients.fat ?? null),
    fiber: text(draft?.nutrients.fiber ?? null),
    sugar: text(draft?.nutrients.sugar ?? null),
  };
}

function LabelForm({
  code,
  draft,
  known,
  onBack,
  onSaved,
}: {
  code: string;
  draft: LabelDraft | null;
  known: KnownProduct | undefined;
  onBack: () => void;
  onSaved: (result: ContributeResult) => void;
}) {
  const { t } = useTranslation(["barcode", "common"]);
  const [fields, setFields] = useState<Fields>(() => initialFields(draft, known));
  const [unit, setUnit] = useState<LabelUnit>(draft?.unit ?? known?.unit ?? "g");
  const [basis, setBasis] = useState<LabelBasis>(draft?.basis ?? "serving");
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [saving, setSaving] = useState(false);

  const clearFeedback = (key?: keyof Fields) => {
    if (key) setErrors((prev) => ({ ...prev, [key]: undefined }));
    setServerError(null);
    setMismatch(false);
  };
  const update = (key: keyof Fields) => (value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    clearFeedback(key);
  };

  const parsed = {
    kcal: readNum(fields.kcal, NUTRIENT_MAX.kcal),
    protein: readNum(fields.protein, NUTRIENT_MAX.protein),
    carbs: readNum(fields.carbs, NUTRIENT_MAX.carbs),
    fat: readNum(fields.fat, NUTRIENT_MAX.fat),
    fiber: readNum(fields.fiber, NUTRIENT_MAX.fiber),
    sugar: readNum(fields.sugar, NUTRIENT_MAX.sugar),
  };
  const serving = readNum(fields.serving, SERVING_MAX);
  const nutrients: LabelNutrients = {
    kcal: parsed.kcal.value,
    protein: parsed.protein.value,
    carbs: parsed.carbs.value,
    fat: parsed.fat.value,
    fiber: parsed.fiber.value,
    sugar: parsed.sugar.value,
  };
  const per100 = toPer100(basis, serving.value, nutrients);
  const rejection = per100 ? checkPer100(per100) : null;

  // Draft warnings that the typed values have not resolved yet. The two numeric
  // checks are re-run live above, so the draft's stale copies are not repeated.
  const warnings = (draft?.warnings ?? []).filter((warning) => {
    if (warning === "implausible" || warning === "energy_mismatch") return false;
    if (warning === "no_serving_size") return serving.value === null;
    if (warning === "no_energy") return parsed.kcal.value === null;
    return true;
  });

  const submit = async (confirmEnergyMismatch = false) => {
    const next: Partial<Record<keyof Fields, string>> = {};
    if (fields.name.trim() === "") next.name = t("label.form.nameRequired");
    if (fields.kcal.trim() === "") next.kcal = t("label.form.kcalRequired");
    for (const key of NUTRIENT_KEYS) {
      if (parsed[key].invalid) next[key] = t("label.form.numberInvalid");
    }
    if (serving.invalid || serving.value === 0) next.serving = t("label.form.numberInvalid");
    else if (basis === "serving" && serving.value === null) next.serving = t("label.form.servingRequired");
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    setServerError(null);
    try {
      const result = await client.barcode.contribute({
        code,
        name: fields.name.trim(),
        brand: fields.brand.trim() || undefined,
        quantity: fields.quantity.trim() || undefined,
        servingSize: serving.value ?? undefined,
        unit,
        basis,
        kcal: parsed.kcal.value ?? 0,
        protein: parsed.protein.value ?? undefined,
        carbs: parsed.carbs.value ?? undefined,
        fat: parsed.fat.value ?? undefined,
        fiber: parsed.fiber.value ?? undefined,
        sugar: parsed.sugar.value ?? undefined,
        confirmEnergyMismatch: confirmEnergyMismatch || undefined,
      });
      onSaved(result);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t("save.failed"));
      const reason = err instanceof ORPCError ? (err.data as { reason?: string } | undefined)?.reason : undefined;
      setMismatch(reason === "energy_mismatch");
    } finally {
      setSaving(false);
    }
  };

  const nutrientFields: Array<{ key: NutrientKey; label: string; placeholder: string }> = [
    { key: "kcal", label: t("label.form.kcal"), placeholder: "150" },
    { key: "protein", label: t("label.form.protein"), placeholder: "2,5" },
    { key: "carbs", label: t("label.form.carbs"), placeholder: "18" },
    { key: "fat", label: t("label.form.fat"), placeholder: "7" },
    { key: "fiber", label: t("label.form.fiber"), placeholder: "1" },
    { key: "sugar", label: t("label.form.sugar"), placeholder: "3" },
  ];

  return (
    <Card>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-1">
          <h2 className="text-lg font-bold">{t("label.form.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("label.form.hint")}</p>
        </div>

        <TextField
          id="label-name"
          label={t("label.form.name")}
          value={fields.name}
          onChange={update("name")}
          error={errors.name}
          placeholder={t("label.form.namePlaceholder")}
          maxLength={120}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id="label-brand"
            label={t("label.form.brand")}
            value={fields.brand}
            onChange={update("brand")}
            maxLength={80}
          />
          <TextField
            id="label-quantity"
            label={t("label.form.quantity")}
            value={fields.quantity}
            onChange={update("quantity")}
            placeholder="68 g"
            maxLength={60}
          />
        </div>

        <Segmented
          label={t("label.form.unit")}
          value={unit}
          onChange={(value) => {
            setUnit(value);
            clearFeedback();
          }}
          options={[
            { value: "g", label: "g" },
            { value: "ml", label: "ml" },
          ]}
        />
        <TextField
          id="label-serving"
          label={t("label.form.serving", { unit })}
          value={fields.serving}
          onChange={update("serving")}
          error={errors.serving}
          inputMode="decimal"
          placeholder="30"
        />

        <Segmented
          label={t("label.form.basis")}
          value={basis}
          onChange={(value) => {
            setBasis(value);
            clearFeedback("serving");
          }}
          options={[
            { value: "serving", label: t("label.form.basisServing") },
            { value: "per100", label: t("label.form.basisPer100", { unit }) },
          ]}
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {nutrientFields.map((field) => (
            <TextField
              key={field.key}
              id={`label-${field.key}`}
              label={field.label}
              value={fields[field.key]}
              onChange={update(field.key)}
              error={errors[field.key]}
              inputMode="decimal"
              placeholder={field.placeholder}
            />
          ))}
        </div>

        {per100 && (
          <p className="text-center text-sm font-semibold tabular-nums">
            {t("label.form.preview", { kcal: fmtInt(per100.kcal100), unit })}
          </p>
        )}
        {rejection && (
          <Notice tone={rejection === "implausible" ? "error" : "warn"}>
            {t(`label.warning.${rejection}`)}
          </Notice>
        )}
        {warnings.map((warning) => (
          <Notice key={warning} tone="warn">
            {t(`label.warning.${warning}`)}
          </Notice>
        ))}
        {serverError && (
          <p role="alert" className="px-1 text-sm text-destructive">
            {serverError}
          </p>
        )}

        <div className="space-y-2">
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {saving ? t("label.form.saving") : t("label.form.save")}
          </Button>
          {mismatch && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={saving}
              onClick={() => void submit(true)}
            >
              {t("label.form.unusual")}
            </Button>
          )}
          <Button type="button" variant="ghost" className="w-full" disabled={saving} onClick={onBack}>
            {t("common:actions.back")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  ...props
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
} & Omit<React.ComponentProps<"input">, "id" | "value" | "onChange">) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        autoComplete="off"
        {...props}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 px-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Notice({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-2xl bg-muted px-3 py-2.5 text-sm",
        tone === "error" ? "text-destructive" : "text-foreground",
      )}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Thanks
// ---------------------------------------------------------------------------

/** Shown above the found/log card once a contribution went through. */
export function LabelThanks({
  outcome,
  contributors,
  onContinue,
}: {
  outcome: ContributeResult["outcome"];
  contributors: number;
  onContinue: () => void;
}) {
  const { t } = useTranslation("barcode");
  return (
    <Card role="status" className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <Check className="size-4" />
        </span>
        <h2 className="text-lg font-bold">{t("label.thanks.title")}</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        {outcome === "saved"
          ? t("label.thanks.saved")
          : outcome === "confirmed"
            ? t("label.thanks.confirmed", { count: contributors })
            : t("label.thanks.outvoted")}
      </p>
      <Button className="w-full" onClick={onContinue}>
        {t("label.thanks.continue")}
      </Button>
    </Card>
  );
}
