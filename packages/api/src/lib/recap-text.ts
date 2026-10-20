// Fixed wording of the weekly reflection: every selected fact (lib/recap-facts.ts) has a title, an observation and, for
// focus points, one piece of advice per (code, variant) in packages/i18n reflection.json. The template text every
// account gets is these strings in a fixed order; the AI text of Pro accounts is only allowed to rephrase them
// (lib/recap-ai.ts). Casual "kamu" / "you", no emojis.

import { fmtDate, fmtNumber, getT } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import type { Fact, FactCode, FactParams, FactSelection, ReflectionMode } from "./recap-facts";

export interface FactView {
  code: FactCode;
  variant: string;
  /** Short heading for lists and chips. */
  title: string;
  /** What the numbers say, one or two sentences. */
  text: string;
  /** What to do about it; null for wins. */
  advice: string | null;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const translator = (locale: Locale): Translate => getT(locale, "reflection") as unknown as Translate;

/** The param i18next counts plural forms by, for the texts that say "1 day" / "3 days". */
const PLURAL_PARAM: Partial<Record<FactCode, string>> = {
  WEIGH_INS: "count",
  MEASURE_ANOMALY: "days",
  ACTIVE_WEEK: "activeDays",
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The localized string of a param the way the text (and the AI) writes it: "1.950", "107,7", "5 Mar 2027". */
export function formatParam(value: FactParams[string], locale: Locale): string | null {
  if (typeof value === "number") return fmtNumber(value, 2, locale);
  if (typeof value === "string") return ISO_DAY.test(value) ? fmtDate(value, "medium", locale) : value;
  return null;
}

/** Every param of a fact as the string the template interpolates. Null / boolean params are left out. */
export function formatParams(params: FactParams, locale: Locale): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const text = formatParam(value, locale);
    if (text !== null) out[key] = text;
  }
  return out;
}

/** Title, observation and advice of one fact, in `locale`. */
export function renderFact(fact: Fact, locale: Locale): FactView {
  const t = translator(locale);
  const base = `facts.${fact.code}.${fact.variant}`;
  const options: Record<string, unknown> = formatParams(fact.params, locale);
  const pluralParam = PLURAL_PARAM[fact.code];
  const count = pluralParam ? fact.params[pluralParam] : undefined;
  if (typeof count === "number") options.count = count;

  // The sleep pattern has one fixed sentence per confidence ("mungkin" / "cenderung"); the model never picks the hedge.
  const textKey = fact.code === "SLEEP_FACTOR" ? `${base}.text_${fact.params.confidence === "leaning" ? "leaning" : "maybe"}` : `${base}.text`;
  let text = t(textKey, options);
  if (fact.code === "WEIGHT_PACE" && fact.params.projectedDate) text += ` ${t("facts.WEIGHT_PACE.projected", options)}`;
  if (fact.code === "RUN_INTENSITY" && fact.params.avgHrBpm != null && fact.params.maxHrBpm != null) {
    text += ` ${t("facts.RUN_INTENSITY.hr", options)}`;
  }
  if (fact.code === "RUN_INTENSITY" && fact.params.loadRatio != null) text += ` ${t("facts.RUN_INTENSITY.load", options)}`;
  let advice = fact.role === "focus" ? t(`${base}.advice`, options) : null;
  if (advice !== null && fact.code === "RUN_INTENSITY" && fact.params.loadRatio != null) advice += ` ${t("facts.RUN_INTENSITY.loadAdvice", options)}`;
  return { code: fact.code, variant: fact.variant, title: t(`${base}.title`), text, advice };
}

export interface ReflectionBody {
  wins: FactView[];
  focus: FactView[];
  /** Closing label of the numbered focus list ("Fokus minggu depan:"), the same line the AI text must use. */
  closingLabel: string;
  /** The deterministic text: wins, then the points to watch, then the numbered focus list. */
  templateText: string;
}

/** Renders the selection and the template text around it. */
export function renderSelection(selection: FactSelection, locale: Locale, mode: ReflectionMode): ReflectionBody {
  const t = translator(locale);
  const wins = selection.wins.map((fact) => renderFact(fact, locale));
  const focus = selection.focus.map((fact) => renderFact(fact, locale));
  const closingLabel = t("text.closing");

  const paragraphs: string[] = [];
  if (wins.length > 0) paragraphs.push(`${t("text.winsIntro")} ${wins.map((v) => v.text).join(" ")}`);
  if (focus.length > 0) {
    paragraphs.push(`${t("text.focusIntro")} ${focus.map((v) => v.text).join(" ")}`);
    paragraphs.push([closingLabel, ...focus.map((v, i) => `${i + 1}. ${v.advice}`)].join("\n"));
  } else {
    paragraphs.push(t("text.keepGoing"));
  }
  if (mode === "maternal") paragraphs.push(t("text.maternalNote"));
  return { wins, focus, closingLabel, templateText: paragraphs.join("\n\n") };
}
