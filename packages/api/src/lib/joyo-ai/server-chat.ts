// The hosted Joyo AI engine on the server: input shape, model choice, the person read from the account (age, sex, height,
// goal only), and one answer run through Core's answer loop with the OpenAI adapter over the Workers AI binding.
// Nothing here stores a message; gates, the daily cap and the stream live in routers/joyo.ts.

import { z } from "zod";

import { getT, LOCALES } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";
import type { Database } from "@joyorogo/db";
import { profile } from "@joyorogo/db/schema/fitness";
import { eq } from "drizzle-orm";

import { daysBetween } from "../engine";
import { dateSchema } from "../schemas";
import { DEFAULT_CORRECT_MODEL } from "../scan-correct";
import type { AiRunner } from "../vision";
import { openAiAdapter } from "./adapters/openai";
import { answer } from "./answer";
import type { Answer, AnswerEvent } from "./answer";
import { gatherDigestSource } from "./digest";
import { foodBlockFor } from "./food-block";
import { MIN_ADULT_AGE } from "./person";
import type { Person } from "./person";
import type { ChatLine, SafetyText } from "./safety";
import type { ToolData } from "./tool-data";
import { AiError } from "./types";
import type { Adapter } from "./types";
import { workersAiFetch } from "./workers-ai-fetch";

export const JOYO_CHAT_LIMITS = {
  maxMessages: 12,
  maxMessageChars: 2_000,
  /** The whole question, digest and tool rounds included. */
  deadlineMs: 45_000,
  /** How far the device's day may differ from the person's zone day before the server's day wins. */
  deviceDaySlackDays: 2,
} as const;

export const joyoChatInputSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(JOYO_CHAT_LIMITS.maxMessageChars),
      }),
    )
    .min(1)
    .max(JOYO_CHAT_LIMITS.maxMessages)
    .refine((list) => list[list.length - 1]?.role === "user", "last message must be from the user"),
  locale: z.enum(LOCALES).optional(),
  /** The device's calendar day. Used only when it is within two days of the server's day for this person's zone. */
  today: dateSchema.optional(),
  /** The hosted-consent version the person agreed to; a different one means the person has not agreed to what is sent now. */
  consentVersion: z.number().int(),
});
export type JoyoChatInput = z.infer<typeof joyoChatInputSchema>;

/** What the stream ends with. Counts only: the question and the answer are not kept anywhere on the server. */
export interface JoyoDone {
  reply: string;
  fixed: boolean;
  flagged: Answer["flagged"];
  steps: Answer["steps"];
  reasoning: string;
  usage: { inputTokens: number; outputTokens: number; calls: number };
  toolsUnsupported: boolean;
  usedToday: number;
  dailyCap: number;
}

export type JoyoEvent = AnswerEvent | { type: "done"; result: JoyoDone };

/** `AI_JOYO_MODEL`, else the coach's model, else the correction model, else the default text model. */
export function joyoModel(env: { AI_JOYO_MODEL?: string; AI_COACH_MODEL?: string; AI_CORRECT_MODEL?: string }): string {
  return env.AI_JOYO_MODEL || env.AI_COACH_MODEL || env.AI_CORRECT_MODEL || DEFAULT_CORRECT_MODEL;
}

/** The device's day when it is within two days of the person's zone day, else the zone day (a wrong clock cannot ask for another week). */
export function deviceDay(requested: string | undefined, zoneDay: string): string {
  if (requested === undefined) return zoneDay;
  const gap = Math.abs(daysBetween(zoneDay, requested));
  return Number.isFinite(gap) && gap <= JOYO_CHAT_LIMITS.deviceDaySlackDays ? requested : zoneDay;
}

export const isMinorAge = (ageYears: number | null): boolean => ageYears !== null && ageYears < MIN_ADULT_AGE;

/**
 * The person as far as the profile says, from three columns only (birth year, gender, height). Pregnancy and breastfeeding
 * mode, name, email and everything else on the profile are never read for Joyo AI. No profile row = everything unknown.
 * `goal` stays null here on purpose: the digest takes it from the profile read of the data seam, which already withholds it
 * for a maternal plan, and this reader must not know the mode.
 */
export async function readJoyoPerson(db: Database, userId: string, nowYear: number): Promise<Person> {
  const [row] = await db
    .select({ birthYear: profile.birthYear, gender: profile.gender, heightCm: profile.heightCm })
    .from(profile)
    .where(eq(profile.userId, userId))
    .limit(1);
  if (!row) return { ageYears: null, sex: null, heightCm: null, goal: null };
  return {
    ageYears: row.birthYear > 1900 ? nowYear - row.birthYear : null,
    sex: row.gender === "male" || row.gender === "female" ? row.gender : null,
    heightCm: Number.isFinite(row.heightCm) && row.heightCm > 0 ? row.heightCm : null,
    goal: null,
  };
}

/** The fixed strings of the safety pass in the person's language. */
export function safetyTextFor(locale: Locale): SafetyText {
  const t = getT(locale, "joyoAi");
  return {
    disclaimer: t("disclaimerLine"),
    refuseLeak: t("refuseLeak"),
    safe: {
      injury: t("safe.injury"),
      medical: t("safe.medical"),
      eatingDisorder: t("safe.eatingDisorder"),
      minorDiet: t("safe.minorDiet"),
    },
  };
}

/** For a message the safety pass answers itself: the model must never be reached (no slot was taken for it). */
export const refusingAdapter: Adapter = {
  async complete() {
    throw new Error("joyo: the model was called for a message that needed no model");
  },
  async listModels() {
    return [];
  },
};

/** Provider calls made so far and their tokens. */
export interface UsageTally {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface RunJoyoChatOptions {
  ai: AiRunner;
  model: string;
  history: readonly ChatLine[];
  person: Person;
  locale: Locale;
  data: ToolData;
  /** Aborted when the client drops the stream. */
  signal?: AbortSignal;
  /** Overall deadline; default {@link JOYO_CHAT_LIMITS.deadlineMs}. */
  deadlineMs?: number;
  onEvent?: (event: AnswerEvent) => void;
  /** Kept up to date as provider calls finish: a question that fails after calling the model still records what it cost. */
  tally?: UsageTally;
  /** Tests inject the adapter; the server always uses the OpenAI adapter. */
  adapter?: Adapter;
}

/**
 * One answer: Core's loop (safety pass, digest, tool rounds, finish) over the OpenAI adapter, with the Workers AI binding as
 * the transport. Thinking is asked off (`chat_template_kwargs.enable_thinking: false`, as the coach and the scans do).
 * A client that drops aborts the model call; the deadline ends the question with a `timeout` AiError whatever it was doing.
 */
export async function runJoyoChat(options: RunJoyoChatOptions): Promise<Answer> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const { promise: deadline, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    reject(new AiError("timeout"));
  }, options.deadlineMs ?? JOYO_CHAT_LIMITS.deadlineMs);

  const run = answer(options.history, {
    adapter: options.adapter ?? openAiAdapter,
    conn: { baseUrl: "workers-ai://", apiKey: "-", model: options.model },
    fetchImpl: workersAiFetch(options.ai, options.model),
    person: options.person,
    locale: options.locale,
    text: safetyTextFor(options.locale),
    gather: () => gatherDigestSource(options.data, options.person, options.locale),
    data: options.data,
    preseed: (lastUserText) => foodBlockFor(lastUserText, options.data),
    toolsEnabled: true,
    fast: true,
    fastFields: { chat_template_kwargs: { enable_thinking: false } },
    signal: controller.signal,
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    afterCall: (usage) => {
      if (!options.tally) return;
      options.tally.calls += 1;
      options.tally.inputTokens += usage?.inputTokens ?? 0;
      options.tally.outputTokens += usage?.outputTokens ?? 0;
    },
  });
  // The deadline can win the race; the loop's own rejection after that must not surface as unhandled.
  run.catch(() => {});
  try {
    return await Promise.race([run, deadline]);
  } catch (error) {
    if (timedOut) throw new AiError("timeout");
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
