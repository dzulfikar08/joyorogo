import { Calendar } from "@joyorogo/ui/components/calendar";
import { Input } from "@joyorogo/ui/components/input";
import { cn } from "@joyorogo/ui/lib/utils";
import { CalendarDays, Check, ChevronDown, Minus, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import {
  babyAgeMonths,
  dueDateFromLmp,
  FEEDING_TYPES,
  MATERNAL_CONDITIONS,
  MAX_BABY_MONTHS,
  PREGNANCY_DAYS,
  MAX_PREGNANCY_DAYS,
} from "@joyorogo/api/lib/maternal";
import type {
  FeedingType,
  MaternalCondition,
  MaternalInput,
  PregnancyDateKind,
} from "@joyorogo/api/lib/maternal";

import { Segmented } from "@/components/kit/surface";
import { fmtDateLong, parseNum } from "@/lib/format";
import type { ProfileRow } from "@/lib/api-types";

export type MaternalDraftMode = "pregnant" | "breastfeeding";

/** What the form edits; `maternalDraftToInput` turns it into the API payload. */
export type MaternalDraft = {
  mode: MaternalDraftMode;
  dateKind: PregnancyDateKind;
  /** YYYY-MM-DD, empty until picked */
  date: string;
  preWeight: string;
  twins: boolean;
  feeding: FeedingType;
  babyMonths: number;
  conditions: MaternalCondition[];
};

export function emptyMaternalDraft(mode: MaternalDraftMode): MaternalDraft {
  return {
    mode,
    dateKind: "hpht",
    date: "",
    preWeight: "",
    twins: false,
    feeding: "exclusive",
    babyMonths: 3,
    conditions: [],
  };
}

/** Prefills Settings > Edit from the stored profile row. */
export function maternalDraftFromRow(row: ProfileRow): MaternalDraft | null {
  const conditions = (row.maternalConditions ?? []).filter((c): c is MaternalCondition =>
    (MATERNAL_CONDITIONS as readonly string[]).includes(c),
  );
  if (row.maternalMode === "pregnant") {
    return {
      ...emptyMaternalDraft("pregnant"),
      dateKind: row.pregnancyDateKind === "hpl" ? "hpl" : "hpht",
      // The server stores HPHT; under HPL the field shows the matching due date.
      date: row.pregnancyLmp
        ? row.pregnancyDateKind === "hpl"
          ? dueDateFromLmp(row.pregnancyLmp)
          : row.pregnancyLmp
        : "",
      preWeight: row.prePregnancyWeightKg != null ? String(row.prePregnancyWeightKg) : "",
      twins: row.pregnancyTwins,
      conditions,
    };
  }
  if (row.maternalMode === "breastfeeding") {
    return {
      ...emptyMaternalDraft("breastfeeding"),
      feeding: row.breastfeedingType === "partial" ? "partial" : "exclusive",
      babyMonths: row.babyBirthDate ? Math.min(babyAgeMonths(row.babyBirthDate), MAX_BABY_MONTHS) : 3,
      preWeight: row.prePregnancyWeightKg != null ? String(row.prePregnancyWeightKg) : "",
      conditions,
    };
  }
  return null;
}

export type DraftResult =
  | { ok: true; input: Exclude<MaternalInput, { mode: "none" }> }
  | { ok: false; error: "date" | "weight" };

const validWeight = (kg: number | null): kg is number => kg !== null && kg >= 25 && kg <= 250;

export function maternalDraftToInput(draft: MaternalDraft): DraftResult {
  const pre = parseNum(draft.preWeight);
  const conditions = draft.conditions.length > 0 ? draft.conditions : undefined;
  if (draft.mode === "pregnant") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return { ok: false, error: "date" };
    if (!validWeight(pre)) return { ok: false, error: "weight" };
    return {
      ok: true,
      input: {
        mode: "pregnant",
        dateKind: draft.dateKind,
        date: draft.date,
        prePregnancyWeightKg: pre,
        twins: draft.twins,
        conditions,
      },
    };
  }
  if (draft.preWeight.trim() !== "" && !validWeight(pre)) return { ok: false, error: "weight" };
  return {
    ok: true,
    input: {
      mode: "breastfeeding",
      feeding: draft.feeding,
      babyAgeMonths: draft.babyMonths,
      prePregnancyWeightKg: pre,
      conditions,
    },
  };
}

function toLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function toIso(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

/** Collapsed date field that opens the app's calendar inline (no portal, safe inside sheets). */
export function DateField({
  label,
  value,
  onChange,
  from,
  to,
  placeholder,
  defaultOpen = false,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  from: string;
  to: string;
  placeholder: string;
  defaultOpen?: boolean;
}) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const tag = i18n.language.startsWith("id") ? "id-ID" : "en-US";
  const captionFormat = new Intl.DateTimeFormat(tag, { month: "long", year: "numeric" });
  const weekdayFormat = new Intl.DateTimeFormat(tag, { weekday: "short" });
  const [month, setMonth] = useState<Date>(() => toLocalDate(value || to));

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="pressable flex min-h-14 w-full items-center gap-3 rounded-xl bg-muted px-4 text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <CalendarDays className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[1.0625rem] font-extrabold tracking-tight",
            !value && "font-semibold text-muted-foreground",
          )}
        >
          {value ? fmtDateLong(value).replace(/^\w+, /, "") : placeholder}
        </span>
        <ChevronDown
          className={cn("size-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && (
        <div className="mt-2 rounded-2xl bg-muted/50 p-2">
          <Calendar
            mode="single"
            className="p-0"
            showOutsideDays={false}
            weekStartsOn={1}
            month={month}
            onMonthChange={setMonth}
            startMonth={toLocalDate(from)}
            endMonth={toLocalDate(to)}
            selected={value ? toLocalDate(value) : undefined}
            disabled={[{ before: toLocalDate(from) }, { after: toLocalDate(to) }]}
            onSelect={(day) => {
              if (day) {
                onChange(toIso(day));
                setOpen(false);
              }
            }}
            formatters={{
              formatCaption: (m) => captionFormat.format(m),
              formatWeekdayName: (d) => weekdayFormat.format(d),
            }}
            classNames={{
              root: "w-full",
              months: "relative w-full",
              month: "w-full",
              month_caption: "relative flex h-11 items-center justify-center",
              caption_label: "text-[0.9375rem] font-bold capitalize",
              nav: "absolute inset-x-0 top-0 z-10 flex h-11 items-center justify-between",
              button_previous:
                "flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30",
              button_next:
                "flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30",
              month_grid: "mt-1 w-full border-collapse",
              weekdays: "flex",
              weekday:
                "flex-1 py-1 text-center text-xs font-semibold text-muted-foreground capitalize",
              week: "mt-1 flex w-full",
              day: "flex-1 p-0 text-center text-sm",
              day_button:
                "mx-auto flex size-10 items-center justify-center rounded-full font-semibold hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
              selected:
                "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button:hover]:bg-primary",
              today: "[&>button]:ring-1 [&>button]:ring-border",
              disabled: "opacity-35 [&>button]:pointer-events-none",
              outside: "opacity-0",
              hidden: "invisible",
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Allowed window per date kind: HPHT is at most 42 weeks back; HPL up to 40 weeks ahead. */
export function pregnancyDateRange(kind: PregnancyDateKind): { from: string; to: string } {
  const today = jakartaToday();
  return kind === "hpht"
    ? { from: shiftDate(today, -MAX_PREGNANCY_DAYS), to: today }
    : { from: shiftDate(today, -(MAX_PREGNANCY_DAYS - PREGNANCY_DAYS)), to: shiftDate(today, PREGNANCY_DAYS) };
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 px-1 text-sm font-bold">{label}</p>
      {children}
      {hint && <p className="mt-2 px-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

function WeightField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <Input
          id={id}
          aria-label={label}
          type="number"
          inputMode="decimal"
          step="0.1"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-14 pr-14 text-center text-2xl font-extrabold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 text-base font-semibold text-muted-foreground">
          kg
        </span>
      </div>
    </Field>
  );
}

function ConditionsField({
  value,
  onChange,
}: {
  value: MaternalCondition[];
  onChange: (value: MaternalCondition[]) => void;
}) {
  const { t } = useTranslation("maternal");
  return (
    <Field label={t("form.conditions.title")} hint={t("form.conditions.optional")}>
      <div className="flex flex-col gap-2">
        {MATERNAL_CONDITIONS.map((key) => {
          const active = value.includes(key);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? value.filter((c) => c !== key) : [...value, key])}
              className={cn(
                "pressable flex min-h-12 items-center gap-3 rounded-xl px-4 text-left text-[0.9375rem] font-semibold focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
                active ? "bg-makan-soft ring-2 ring-makan" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-md border",
                  active ? "border-makan bg-makan text-white" : "border-border bg-card",
                )}
              >
                {active && <Check className="size-3.5" aria-hidden strokeWidth={3} />}
              </span>
              {t(`form.conditions.${key}`)}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

/**
 * The Hamil / Menyusui questions, shared by onboarding and Settings. The
 * current weight is not asked here: onboarding already has its own step and
 * Settings keeps the weigh-ins.
 */
export function MaternalForm({
  draft,
  onChange,
}: {
  draft: MaternalDraft;
  onChange: (patch: Partial<MaternalDraft>) => void;
}) {
  const { t } = useTranslation("maternal");

  if (draft.mode === "pregnant") {
    const range = pregnancyDateRange(draft.dateKind);
    return (
      <div className="space-y-6">
        <Field label={t("form.dateKind.label")}>
          <Segmented
            label={t("form.dateKind.label")}
            value={draft.dateKind}
            onChange={(dateKind) => {
              // The picked date means something else under the other kind.
              onChange({ dateKind, date: "" });
            }}
            options={[
              { value: "hpht", label: t("form.dateKind.hpht") },
              { value: "hpl", label: t("form.dateKind.hpl") },
            ]}
          />
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            {t(draft.dateKind === "hpht" ? "form.dateKind.hphtHint" : "form.dateKind.hplHint")}
          </p>
        </Field>
        <Field
          label={t(draft.dateKind === "hpht" ? "form.date.hpht" : "form.date.hpl")}
          hint={t(draft.dateKind === "hpht" ? "form.date.hphtHelp" : "form.date.hplHelp")}
        >
          <DateField
            key={draft.dateKind}
            label={t(draft.dateKind === "hpht" ? "form.date.hpht" : "form.date.hpl")}
            value={draft.date}
            onChange={(date) => onChange({ date })}
            from={range.from}
            to={range.to}
            placeholder={t("form.date.pick")}
          />
        </Field>
        <WeightField
          id="pre-weight"
          label={t("form.preWeight.label")}
          hint={t("form.preWeight.hint")}
          value={draft.preWeight}
          onChange={(preWeight) => onChange({ preWeight })}
        />
        <Field label={t("form.fetuses.label")}>
          <Segmented
            label={t("form.fetuses.label")}
            value={draft.twins ? "twins" : "single"}
            onChange={(value) => onChange({ twins: value === "twins" })}
            options={[
              { value: "single", label: t("form.fetuses.single") },
              { value: "twins", label: t("form.fetuses.twins") },
            ]}
          />
        </Field>
        <ConditionsField value={draft.conditions} onChange={(conditions) => onChange({ conditions })} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Field label={t("form.feeding.label")}>
        <Segmented
          label={t("form.feeding.label")}
          value={draft.feeding}
          onChange={(feeding) => onChange({ feeding })}
          options={FEEDING_TYPES.map((key) => ({ value: key, label: t(`form.feeding.${key}`) }))}
        />
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          {t(draft.feeding === "exclusive" ? "form.feeding.exclusiveHint" : "form.feeding.partialHint")}
        </p>
      </Field>
      <Field label={t("form.babyAge.label")}>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-muted p-1.5">
          <button
            type="button"
            aria-label={t("form.babyAge.decrease")}
            disabled={draft.babyMonths <= 0}
            onClick={() => onChange({ babyMonths: Math.max(0, draft.babyMonths - 1) })}
            className="pressable grid size-11 place-items-center rounded-lg bg-card focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-40"
          >
            <Minus className="size-5" aria-hidden />
          </button>
          <p className="text-xl font-extrabold tabular-nums" aria-live="polite">
            {t("form.babyAge.months", { months: draft.babyMonths })}
          </p>
          <button
            type="button"
            aria-label={t("form.babyAge.increase")}
            disabled={draft.babyMonths >= MAX_BABY_MONTHS}
            onClick={() => onChange({ babyMonths: Math.min(MAX_BABY_MONTHS, draft.babyMonths + 1) })}
            className="pressable grid size-11 place-items-center rounded-lg bg-card focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-40"
          >
            <Plus className="size-5" aria-hidden />
          </button>
        </div>
      </Field>
      <WeightField
        id="pre-weight"
        label={t("form.preWeight.label")}
        hint={t("form.preWeight.hintOptional")}
        value={draft.preWeight}
        onChange={(preWeight) => onChange({ preWeight })}
      />
      <ConditionsField value={draft.conditions} onChange={(conditions) => onChange({ conditions })} />
    </div>
  );
}
