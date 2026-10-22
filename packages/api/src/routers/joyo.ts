import { ORPCError } from "@orpc/server";

import { protectedProcedure } from "../index";
import { jakartaToday } from "../lib/engine";
import { EventChannel } from "../lib/event-channel";
import { getT } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";
import { CONSENT_VERSION } from "../lib/joyo-ai/consent";
import { assessMessages } from "../lib/joyo-ai/safety";
import { joyoDailyCap, joyoUsedToday, reserveJoyoSlot, settleJoyoSlot } from "../lib/joyo-ai/server-limit";
import {
  deviceDay,
  isMinorAge,
  joyoChatInputSchema,
  joyoModel,
  readJoyoPerson,
  refusingAdapter,
  runJoyoChat,
} from "../lib/joyo-ai/server-chat";
import type { JoyoEvent, UsageTally } from "../lib/joyo-ai/server-chat";
import { rpcFromContext } from "../lib/joyo-ai/server-rpc";
import { createToolData } from "../lib/joyo-ai/tool-data";
import { AiError } from "../lib/joyo-ai/types";
import type { AiErrorKind } from "../lib/joyo-ai/types";
import { userZone } from "../lib/user-zone";
import { cloudUnlocked } from "../lib/watch-workout-store";

/** What the person is told for a failure after the stream started; the provider's own kinds that only the server could fix read as `server`. */
type HostedFailure = "timeout" | "empty" | "truncated" | "aborted" | "rateLimit" | "network" | "server";

function failureKind(kind: AiErrorKind): HostedFailure {
  switch (kind) {
    case "timeout":
    case "empty":
    case "truncated":
    case "aborted":
    case "rateLimit":
    case "network":
      return kind;
    default:
      return "server";
  }
}

/**
 * Joyo AI, hosted engine (Pro). The phone and the web chat call `joyo.chat` and iterate the events; the person's own-key
 * engine on the phone never touches this router.
 */
export const joyoRouter = {
  status: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const zone = await userZone(context);
    const nowYear = Number(jakartaToday(undefined, zone).slice(0, 4));
    const [unlocked, used, person] = await Promise.all([
      cloudUnlocked(context.db, context.env, userId),
      joyoUsedToday(context.db, userId, zone),
      readJoyoPerson(context.db, userId, nowYear),
    ]);
    return {
      unlocked,
      usedToday: used,
      dailyCap: joyoDailyCap(context.env),
      ageBlocked: isMinorAge(person.ageYears),
      consentVersion: CONSENT_VERSION,
    };
  }),

  /**
   * One question. Errors before the first event are ORPCErrors (they surface when the client starts iterating):
   * FORBIDDEN `{ paywall: true }` for a free account, FORBIDDEN `{ reason: 'noConsent' | 'minor' }`, TOO_MANY_REQUESTS
   * `{ reason: 'cap' }`, SERVICE_UNAVAILABLE `{ reason: 'off' }` (cap "0" or no model binding). A worrying message gets a
   * fixed localized answer: the model is not called and no slot is taken. Everything else takes a slot of the daily cap
   * BEFORE the model runs (one conditional statement, so concurrent calls cannot slip past it); the slot counts whatever the
   * model does. Events: Core's AnswerEvents as they happen, then `done`. A failure after the stream started ends it with an
   * ORPCError whose `data.reason` is a `joyoAi:errors.*` key. The question and the answer are not stored.
   */
  chat: protectedProcedure
    .input(joyoChatInputSchema)
    .handler(async function* ({ context, input, signal }): AsyncGenerator<JoyoEvent, void, undefined> {
      const userId = context.session.user.id;
      const locale: Locale = input.locale ?? context.locale;
      const t = getT(locale, "joyoAi");
      const cap = joyoDailyCap(context.env);
      if (cap === 0) throw new ORPCError("SERVICE_UNAVAILABLE", { message: t("blocked.off"), data: { reason: "off" } });
      if (!(await cloudUnlocked(context.db, context.env, userId))) {
        throw new ORPCError("FORBIDDEN", { message: t("blocked.notPro"), data: { paywall: true } });
      }
      if (input.consentVersion !== CONSENT_VERSION) {
        throw new ORPCError("FORBIDDEN", { message: t("blocked.noConsent"), data: { reason: "noConsent" } });
      }
      const zone = await userZone(context);
      const zoneToday = jakartaToday(undefined, zone);
      const person = await readJoyoPerson(context.db, userId, Number(zoneToday.slice(0, 4)));
      if (isMinorAge(person.ageYears)) {
        throw new ORPCError("FORBIDDEN", { message: t("blocked.minor"), data: { reason: "minor" } });
      }
      const ai = context.env.AI;
      if (!ai) throw new ORPCError("SERVICE_UNAVAILABLE", { message: t("blocked.off"), data: { reason: "off" } });

      const model = joyoModel(context.env);
      // The keyword pass runs before anything is reserved: a worrying message is answered by the fixed text alone.
      const fixed = assessMessages(input.messages, { minor: false }).last.reason !== null;
      const slot = fixed ? null : await reserveJoyoSlot(context.db, userId, cap, model, zone);
      if (!fixed && slot === null) {
        throw new ORPCError("TOO_MANY_REQUESTS", { message: t("blocked.cap"), data: { reason: "cap", cap } });
      }

      const day = deviceDay(input.today, zoneToday);
      const data = createToolData(rpcFromContext(context), { today: () => day });
      const channel = new EventChannel<JoyoEvent>();
      const stop = new AbortController();
      signal?.addEventListener("abort", () => stop.abort(), { once: true });
      const startedAt = Date.now();
      const tally: UsageTally = { calls: 0, inputTokens: 0, outputTokens: 0 };

      // The slot was counted when it was reserved; this only records what happened (counts, never text). Once only: the
      // client dropping the stream and the run ending race each other.
      let settled = false;
      const settle = (outcome: string) => {
        if (settled || slot === null) return;
        settled = true;
        context.waitUntil(
          settleJoyoSlot(context.db, slot, {
            latencyMs: Date.now() - startedAt,
            outcome,
            turns: input.messages.length,
            calls: tally.calls,
            usage: tally.calls > 0 ? { inputTokens: tally.inputTokens, outputTokens: tally.outputTokens } : null,
          }).catch((error: unknown) => console.error("[joyo] ledger update failed", error)),
        );
      };

      const drive = async () => {
        try {
          const answer = await runJoyoChat({
            ai,
            model,
            history: input.messages,
            person,
            locale,
            data,
            signal: stop.signal,
            onEvent: (event) => channel.push(event),
            tally,
            ...(fixed ? { adapter: refusingAdapter } : {}),
          });
          settle(answer.fixed ? "fixed" : "ok");
          const usedToday = await joyoUsedToday(context.db, userId, zone);
          channel.push({
            type: "done",
            result: {
              reply: answer.reply,
              fixed: answer.fixed,
              flagged: answer.flagged,
              steps: answer.steps,
              reasoning: answer.reasoning,
              usage: { inputTokens: answer.usage.inputTokens, outputTokens: answer.usage.outputTokens, calls: answer.usage.calls },
              toolsUnsupported: answer.toolsUnsupported,
              usedToday,
              dailyCap: cap,
            },
          });
          channel.close();
        } catch (error) {
          const kind = error instanceof AiError ? failureKind(error.kind) : "server";
          // Kind and status only: provider messages can quote the prompt. A client that left is not a failure.
          if (kind !== "aborted") {
            console.error("[joyo] failed", error instanceof AiError ? `${error.kind} ${error.status ?? ""}` : error instanceof Error ? error.name : typeof error);
          }
          settle(kind);
          channel.fail(
            new ORPCError(kind === "timeout" ? "INTERNAL_SERVER_ERROR" : "UNPROCESSABLE_CONTENT", {
              message: t(`errors.${kind}`),
              data: { reason: kind },
            }),
          );
        }
      };
      void drive();

      try {
        yield* channel;
      } finally {
        // The client left (or the stream ended): a model call still running is cancelled, and its slot is recorded as aborted.
        stop.abort();
        settle("aborted");
      }
    }),
};
