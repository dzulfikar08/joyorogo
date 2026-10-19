import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../index";
import {
  CoachModelError,
  assessMessages,
  buildCoachSystemPrompt,
  coachChatInputSchema,
  coachModel,
  finishReply,
  personMode,
  runCoachModel,
  safeReply,
} from "../lib/coach-chat";
import { readCoachServerContext } from "../lib/coach-context";
import { COACH_DOC_LIMITS, coachDocSchema, readCoachDoc, writeCoachDoc } from "../lib/coach-doc";
import { coachDailyCap, coachUsedToday, reserveCoachSlot, settleCoachSlot } from "../lib/coach-limit";
import { jakartaToday } from "../lib/engine";
import { serverT } from "../lib/messages";
import { cloudUnlocked } from "../lib/watch-workout-store";

/**
 * JoyoFit's coach (Pro): the synced plan document and the "Tanya coach" chat. Reading the document is open to every
 * signed-in account so data is never locked away; writing and chatting need Pro (same rule as the cloud workouts).
 * Contract and caps: docs/coach.md.
 */
export const coachRouter = {
  status: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const [unlocked, used] = await Promise.all([
      cloudUnlocked(context.db, context.env, userId),
      coachUsedToday(context.db, userId),
    ]);
    return { unlocked, chatUsedToday: used, chatDailyCap: coachDailyCap(context.env) };
  }),

  getDoc: protectedProcedure.handler(({ context }) => readCoachDoc(context.db, context.session.user.id)),

  putDoc: protectedProcedure
    .input(z.object({ baseRev: z.number().int().min(0), doc: coachDocSchema }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      if (new TextEncoder().encode(JSON.stringify(input.doc)).length > COACH_DOC_LIMITS.maxBytes) {
        throw new ORPCError("BAD_REQUEST", { message: serverT(context.locale, "coach")("docTooLarge") });
      }
      if (!(await cloudUnlocked(context.db, context.env, userId))) return { status: "locked" as const };
      return writeCoachDoc(context.db, userId, input.baseRev, input.doc);
    }),

  /**
   * "Tanya coach". A worrying message (injury, symptoms, medication, eating-disorder or minor-diet signals) gets a
   * fixed localized answer and the model is not called, so it costs nothing and counts nothing. Everything else is
   * one model call that counts toward the daily cap whatever it answers. Messages are not stored.
   */
  chat: protectedProcedure.input(coachChatInputSchema).handler(async ({ context, input }) => {
    const userId = context.session.user.id;
    const locale = input.locale ?? context.locale;
    const t = serverT(locale, "coach");
    const cap = coachDailyCap(context.env);
    if (cap === 0) throw new ORPCError("SERVICE_UNAVAILABLE", { message: t("disabled") });
    if (!(await cloudUnlocked(context.db, context.env, userId))) {
      throw new ORPCError("FORBIDDEN", { message: t("locked"), data: { paywall: true } });
    }
    const used = await coachUsedToday(context.db, userId);

    const today = jakartaToday();
    const server = await readCoachServerContext(
      context.db,
      userId,
      today,
      Number(today.slice(0, 4)),
      input.snapshot.workouts.length < 3 ? 10 : 0,
    );
    const minor = (server.profile?.age ?? 99) < 18;
    const safety = assessMessages(input.messages, { minor });
    if (safety.last.reason !== null) {
      return { reply: safeReply(safety.last.reason, locale), used, cap, flagged: safety.last.flagged };
    }
    if (used >= cap) {
      throw new ORPCError("TOO_MANY_REQUESTS", { message: t("capReached", { cap }), data: { coachCapReached: true, cap } });
    }
    const ai = context.env.AI;
    if (!ai) {
      throw new ORPCError("SERVICE_UNAVAILABLE", { message: serverT(locale, "errors")("ai.unavailable") });
    }

    const model = coachModel(context.env);
    // The slot is taken before the model runs, in one conditional statement: concurrent requests cannot slip past the cap.
    const slot = await reserveCoachSlot(context.db, userId, cap, model);
    if (slot === null) {
      throw new ORPCError("TOO_MANY_REQUESTS", { message: t("capReached", { cap }), data: { coachCapReached: true, cap } });
    }
    const startedAt = Date.now();
    let reply: string | null = null;
    let usage: Record<string, unknown> | null = null;
    let outcome = "ok";
    try {
      const run = await runCoachModel(ai, {
        model,
        system: buildCoachSystemPrompt({ locale, snapshot: input.snapshot, server, safety }),
        messages: input.messages,
      });
      usage = run.usage;
      const lastUserText = input.messages[input.messages.length - 1]?.content ?? "";
      reply = finishReply(run.text, { locale, lastUserText, mode: personMode(server, safety.maternalMention) });
      if (reply === null) outcome = "empty";
    } catch (error) {
      outcome = error instanceof CoachModelError ? error.reason : "failed";
      if (!(error instanceof CoachModelError)) console.error("[coach] failed", error);
    }
    // The slot was counted when it was reserved (every call that reached the model counts, answer or not). Only counts and
    // token usage are kept.
    context.waitUntil(
      settleCoachSlot(context.db, slot, { latencyMs: Date.now() - startedAt, outcome, turns: input.messages.length, usage }).catch(
        (error: unknown) => console.error("[coach] ledger update failed", error),
      ),
    );
    if (reply === null) {
      throw new ORPCError(outcome === "timeout" ? "INTERNAL_SERVER_ERROR" : "UNPROCESSABLE_CONTENT", {
        message: t(outcome === "timeout" ? "timeout" : "failed"),
        data: { reason: outcome },
      });
    }
    return { reply, used: await coachUsedToday(context.db, userId), cap, flagged: null };
  }),
};
