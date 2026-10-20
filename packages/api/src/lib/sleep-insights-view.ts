// Renders the engine's state into the cards, progress rows and last-night stats of `sleepInsights.get`
// (text from packages/i18n sleepInsights.json, server side like the weekly reflection).

import type { Database } from "@joyorogo/db";
import type { Locale } from "@joyorogo/i18n";

import { getT } from "@joyorogo/i18n";

import { MAX_CARDS, MIN_WINDOW_NIGHTS, hasRecentAlcohol, lastCaffeineBeforeBed, needOf, socialJetlag, visibleFindings, weekRegularity } from "./sleep-insights";
import { FACTORS } from "./sleep-insights";
import { computeState, type SleepPref } from "./sleep-insights-store";
import type {
  SleepCard,
  SleepFactor,
  SleepFinding,
  SleepInsightsView,
  SleepLastNight,
  SleepProgressRow,
} from "./sleep-insights-types";

type Translate = (key: string, params?: Record<string, string | number>) => string;

const URLS = {
  iom: "https://www.ncbi.nlm.nih.gov/books/NBK223808/",
  drake: "https://pubmed.ncbi.nlm.nih.gov/24235903/",
  ebrahim: "https://pubmed.ncbi.nlm.nih.gov/23347102/",
  duan: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8131073/",
  stutz: "https://pubmed.ncbi.nlm.nih.gov/30374942/",
  windred: "https://pubmed.ncbi.nlm.nih.gov/37738616/",
  wittmann: "https://pubmed.ncbi.nlm.nih.gov/16687322/",
  okamoto: "https://pubmed.ncbi.nlm.nih.gov/22738673",
} as const;

const PERSONAL_SOURCE: Record<SleepFactor, keyof typeof URLS> = {
  caffeine: "drake",
  dinner: "duan",
  workout: "stutz",
  regularity: "windred",
  temperature: "okamoto",
  humidity: "okamoto",
};

/** Which wording a finding takes: the sign of the difference. */
function directionOf(f: SleepFinding): string {
  const down = f.diff < 0;
  return f.outcome === "asleep" ? (down ? "shorter" : "longer") : down ? "less" : "more";
}

export function personalCard(t: Translate, f: SleepFinding): SleepCard {
  const body = t(`personal.${f.factor}.${directionOf(f)}`, {
    exposed: f.exposed,
    other: f.other,
    minutes: Math.round(Math.abs(f.diff)),
    value: f.threshold ?? 0,
  });
  const tail = t(`personal.tail.${f.confidence}`, { total: f.exposed + f.other });
  return {
    id: `personal:${f.factor}`,
    kind: "personal",
    topic: f.factor,
    text: `${body} ${tail}`,
    confidence: f.confidence,
    exposed: f.exposed,
    other: f.other,
    nights: f.nights,
    sources: [{ label: t(`personal.${f.factor}.sourceLabel`), url: URLS[PERSONAL_SOURCE[f.factor]] }],
  };
}

function generalCard(t: Translate, topic: string, params: Record<string, string | number>, source: keyof typeof URLS): SleepCard {
  return {
    id: `general:${topic}`,
    kind: "general",
    topic,
    text: t(`general.${topic}.text`, params),
    confidence: null,
    exposed: null,
    other: null,
    nights: [],
    sources: [{ label: t(`general.${topic}.sourceLabel`), url: URLS[source] }],
  };
}

function clock(locale: Locale, hhmm: string): string {
  return locale === "id" ? hhmm.replace(":", ".") : hhmm;
}

export async function buildSleepView(
  db: Database,
  userId: string,
  pref: SleepPref,
  opts: { locale: Locale; pro: boolean; now?: Date },
): Promise<SleepInsightsView> {
  const now = opts.now ?? new Date();
  const personalState: SleepInsightsView["personal"] = opts.pro ? "needs_nights" : "locked";
  if (!pref.enabled) {
    return { enabled: false, personal: personalState, lockedCount: 0, cards: [], progress: [], lastNight: null, regularity: null };
  }
  const t = getT(opts.locale, "sleepInsights") as unknown as Translate;
  const { inputs, states } = await computeState(db, userId, pref, now);
  const { nights, foods, ctx } = inputs;
  const hidden = new Set(pref.dismissed);

  const findings = visibleFindings(states).filter((f) => !hidden.has(`personal:${f.factor}`));
  const strength = (f: SleepFinding) => (f.confidence === "leaning" ? 1 : 0);
  findings.sort((a, b) => strength(b) - strength(a) || b.exposed - a.exposed || FACTORS.indexOf(a.factor) - FACTORS.indexOf(b.factor));

  const cards: SleepCard[] = [];
  if (opts.pro) for (const f of findings) cards.push(personalCard(t, f));

  // General tips tied to the person's own logged times: need a few nights, never statistical.
  const general: SleepCard[] = [];
  if (nights.length >= 3) {
    if (!ctx.maternal) {
      const caffeine = lastCaffeineBeforeBed(foods, nights, now.getTime());
      if (caffeine) {
        general.push(generalCard(t, "caffeine", { time: clock(opts.locale, caffeine.clock), hours: caffeine.hoursBeforeBed }, "iom"));
      }
    }
    const reg = weekRegularity(nights);
    if (reg && reg.sdMin >= 60) general.push(generalCard(t, "regularity", { minutes: reg.sdMin }, "windred"));
    const through = nights[nights.length - 1]!.wakeDate;
    const jet = socialJetlag(nights, ctx.freeDaysMask, through);
    if (jet !== null && Math.abs(jet) >= 60) {
      general.push(
        generalCard(t, "jetlag", { minutes: Math.abs(jet), direction: t(jet > 0 ? "general.jetlag.later" : "general.jetlag.earlier") }, "wittmann"),
      );
    }
    const last = nights[nights.length - 1]!;
    if (last.tempCMean !== null && last.rhPctMean !== null) {
      general.push(generalCard(t, "room", { temp: Math.round(last.tempCMean), rh: Math.round(last.rhPctMean) }, "okamoto"));
    }
    if (!ctx.maternal && hasRecentAlcohol(foods, now.getTime())) general.push(generalCard(t, "alcohol", {}, "ebrahim"));
  }
  for (const card of general) {
    if (cards.length >= MAX_CARDS) break;
    if (!hidden.has(card.id)) cards.push(card);
  }

  const progress: SleepProgressRow[] = [];
  if (nights.length < MIN_WINDOW_NIGHTS) {
    progress.push({
      id: "nights",
      text: t("progress.nights", { need: MIN_WINDOW_NIGHTS - nights.length, have: nights.length, total: MIN_WINDOW_NIGHTS }),
      have: nights.length,
      need: MIN_WINDOW_NIGHTS,
    });
  }
  if (nights.length >= 3) {
    for (const factor of FACTORS) {
      const state = states[factor];
      if (!state || state.status !== "none") continue;
      const need = needOf(state.eval);
      if (!need) continue;
      progress.push({
        id: factor,
        text: t(`progress.${factor}`, { need: need.need, what: t(`progress.${factor}What.${need.side}`) }),
        have: need.have,
        need: need.have + need.need,
      });
    }
  }

  const last = nights[nights.length - 1];
  const lastNight: SleepLastNight | null = last
    ? {
        wakeDate: last.wakeDate,
        asleepMin: Math.round(last.asleepS / 60),
        awakeMin: Math.round(last.awakeS / 60),
        awakenings: last.awakenings,
        hrvMs: last.hrvMs,
        rhrBpm: last.rhrBpm,
        hasStages: last.hasStages,
        deepMin: last.deepS === null ? null : Math.round(last.deepS / 60),
        remMin: last.remS === null ? null : Math.round(last.remS / 60),
        room: last.tempCMean !== null && last.rhPctMean !== null ? { tempC: last.tempCMean, rhPct: last.rhPctMean } : null,
      }
    : null;

  return {
    enabled: true,
    personal: !opts.pro ? "locked" : nights.length < MIN_WINDOW_NIGHTS ? "needs_nights" : "ready",
    lockedCount: findings.length,
    cards,
    progress,
    lastNight,
    regularity: weekRegularity(nights),
  };
}
