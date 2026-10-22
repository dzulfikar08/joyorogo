// Ported from JoyoFit (watch-fit) src/features/ai/answer.ts, adapted for JoyoRogo.
// One Joyo AI answer, engine-agnostic: the caller supplies the transport (a BYOK adapter + key, or the OpenAI adapter over
// `workersAiFetch` for the hosted engine) and the gates (consent, key, age, cap) are checked by the caller before this runs.
import type { Locale } from '@joyorogo/i18n';

import { buildDigest, digestJson, type Digest, type DigestSource } from './digest';
import type { Person } from './person';
import { assessMessages, buildSystemPrompt, finishReply, personMode, safeReply, SAFETY_LIMITS, type ChatLine, type CoachFlag, type SafetyText } from './safety';
import { noMark, type Mark } from './timing';
import type { ToolData } from './tool-data';
import { isToolName, runTool, toolSpecsFor, type ToolSummary, type ToolTrace } from './tools';
import { AiError, type Adapter, type NeutralMessage, type ProviderConnection, type ToolCall, type Usage } from './types';

export const ANSWER_LIMITS = { toolRounds: 4, toolCallsPerRound: 4, maxTokens: 800, maxTokensRetry: 2_400, turns: 12, reasoningChars: 6_000, oldAnswerChars: 500 } as const;

export type AnswerEvent =
  /** A provider call starts (the first one, or the next after tools ran). Text from the previous call, if any, is kept. */
  | { type: 'round'; round: number }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'toolStart'; id: string; trace: ToolTrace }
  | { type: 'toolDone'; id: string; trace: ToolTrace; summary: ToolSummary };

/** One tool the answer ran, kept with the message: what was read and how it went. */
export interface AnswerStep {
  id: string;
  trace: ToolTrace;
  summary: ToolSummary;
}

export interface Answer {
  reply: string;
  /** The fixed answer of the keyword pass was used: no provider call was made. */
  fixed: boolean;
  flagged: CoachFlag | null;
  /** What the answer read, in order: shown as "based on". */
  trace: ToolTrace[];
  /** The same tools with how each went (rows found, nothing, failed): the collapsible steps of the chat. */
  steps: AnswerStep[];
  /** The reasoning the model wrote, when it sent any. Never part of the reply. */
  reasoning: string;
  usage: Usage & { calls: number };
  /** This model has no tool calling: the answer used the digest and food block alone. */
  toolsUnsupported: boolean;
  /** The digest sent, for the "what was sent" view. */
  digest: Digest | null;
}

export interface AnswerDeps {
  /** Transport: the BYOK adapter + key, or the hosted engine (OpenAI adapter over `workersAiFetch`). */
  adapter: Adapter;
  conn: ProviderConnection;
  person: Person;
  locale: Locale;
  text: SafetyText;
  /** Digest source, gathered fresh per question. */
  gather: () => Promise<DigestSource>;
  data: ToolData;
  /** The food block for the system prompt (`foodBlockFor`); a failure is ignored. */
  preseed?: (lastUserText: string) => Promise<string | null>;
  /** False = digest and food block only (a model without tool calling). */
  toolsEnabled?: boolean;
  /** The adapter said the model has no tool calling: the caller remembers it. */
  onNoTools?: () => void;
  /** Throws `AiError('blocked', null, reason)` when a call is not allowed (the own-key daily ceiling). Runs before every provider call. */
  beforeCall?: () => void;
  /** After every provider call: its usage (null when unreported) and whether it succeeded. */
  afterCall?: (usage: Usage | null, ok: boolean) => void;
  fast?: boolean;
  fastFields?: Record<string, unknown>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Timing marks for this question (numbers only); see `timing.ts`. */
  mark?: Mark;
  /** Live events of the answer being written. */
  onEvent?: (event: AnswerEvent) => void;
}

/**
 * One answer end to end. Order matters and is tested:
 *  1. the keyword safety pass over the conversation: a worrying last message gets the fixed answer, NO provider call, NO `beforeCall`;
 *  2. `beforeCall`;
 *  3. the digest, the food block and the system prompt, then at most `toolRounds` rounds of provider call and tool runs (all read-only);
 *  4. the reply is cleaned and the disclaimer is added in code where needed.
 */
export async function answer(history: readonly ChatLine[], deps: AnswerDeps): Promise<Answer> {
  // Older answers are cut: they were already read, and every token of them is paid for and waited for again in each question.
  const recent = history.slice(-ANSWER_LIMITS.turns);
  const turns = recent.map((t, i) => ({
    role: t.role,
    content: t.role === 'assistant' && i < recent.length - 2 && t.content.length > ANSWER_LIMITS.oldAnswerChars ? `${t.content.slice(0, ANSWER_LIMITS.oldAnswerChars)}...` : t.content.slice(0, SAFETY_LIMITS.maxMessageChars),
  }));
  // Anthropic wants the first message from the user; cutting to the last turns can leave an answer in front.
  while (turns.length > 0 && turns[0]!.role !== 'user') turns.shift();
  const lastUser = [...turns].reverse().find((t) => t.role === 'user');
  if (!lastUser) throw new AiError('badRequest');

  const minor = deps.person.ageYears !== null && deps.person.ageYears < 18;
  const safety = assessMessages(turns, { minor });
  const empty = { inputTokens: 0, outputTokens: 0, calls: 0 };
  if (safety.last.reason) {
    return { reply: safeReply(safety.last.reason, deps.text), fixed: true, flagged: safety.last.flagged, trace: [], steps: [], reasoning: '', usage: empty, toolsUnsupported: false, digest: null };
  }

  deps.beforeCall?.();

  const mark = deps.mark ?? noMark;
  mark('start');
  const source = await deps.gather();
  mark('digest-gathered');
  const digest = buildDigest(source);
  const digestText = digestJson(digest);
  mark('digest-built', { chars: digestText.length });
  let foodBlock: string | null = null;
  if (deps.preseed) {
    try {
      foodBlock = await deps.preseed(lastUser.content);
    } catch {
      foodBlock = null;
    }
  }
  mark('food-block', { chars: foodBlock?.length ?? 0 });
  const mode = personMode(deps.person, safety.maternalMention);

  let toolsOn = deps.toolsEnabled !== false;
  const messages: NeutralMessage[] = turns.map((t) => (t.role === 'user' ? { role: 'user', content: t.content } : { role: 'assistant', content: t.content }));
  const trace: ToolTrace[] = [];
  const steps: AnswerStep[] = [];
  const spent = { inputTokens: 0, outputTokens: 0, calls: 0 };
  let toolsUnsupported = deps.toolsEnabled === false;
  let reasoning = '';
  let rounds = 0;
  let attempts = 0;

  const call = async (withTools: boolean, maxTokens: number) => {
    // The first call was allowed above; every further one (a tool round, a retry) asks again.
    if (attempts > 0) deps.beforeCall?.();
    attempts += 1;
    deps.onEvent?.({ type: 'round', round: rounds });
    rounds += 1;
    let seenToken = false;
    const system = buildSystemPrompt({ locale: deps.locale, digestJson: digestText, foodBlock, safety, mode, tools: withTools, engine: deps.data.engine });
    try {
      const reply = await deps.adapter.complete(
        deps.conn,
        { model: deps.conn.model, system, messages, tools: withTools ? toolSpecsFor(deps.data.engine) : undefined, maxTokens, fast: deps.fast, fastFields: deps.fastFields },
        {
          signal: deps.signal,
          fetchImpl: deps.fetchImpl,
          mark: (name, extra) => mark(`r${rounds}-${name}`, extra),
          onDelta: (delta) => {
            if (!seenToken && (delta.text || delta.thinking)) {
              seenToken = true;
              mark(`r${rounds}-first-${delta.text ? 'text' : 'reasoning'}`);
            }
            if (delta.thinking) deps.onEvent?.({ type: 'reasoning', delta: delta.thinking });
            if (delta.text) deps.onEvent?.({ type: 'text', delta: delta.text });
          },
        },
      );
      mark(`r${rounds}-done`, { in: reply.usage?.inputTokens ?? 0, out: reply.usage?.outputTokens ?? 0, tools: reply.toolCalls.length, think: reply.thinking.length, text: reply.text.length, finish: reply.finish ?? '' });
      deps.afterCall?.(reply.usage, true);
      spent.calls += 1;
      spent.inputTokens += reply.usage?.inputTokens ?? 0;
      spent.outputTokens += reply.usage?.outputTokens ?? 0;
      if (reply.thinking && reasoning.length < ANSWER_LIMITS.reasoningChars) reasoning = `${reasoning}${reasoning ? '\n\n' : ''}${reply.thinking}`.slice(0, ANSWER_LIMITS.reasoningChars);
      return reply;
    } catch (error) {
      // The provider answered, so it still counts as a call even when it refused.
      if (error instanceof AiError && error.status !== null) deps.afterCall?.(null, false);
      throw error;
    }
  };

  /** One provider call; a thinking model that used its whole budget thinking gets one more try with more room (it counts as a call). */
  const callWithRetry = async (withTools: boolean) => {
    try {
      return await call(withTools, ANSWER_LIMITS.maxTokens);
    } catch (error) {
      if (error instanceof AiError && error.kind === 'truncated') return call(withTools, ANSWER_LIMITS.maxTokensRetry);
      throw error;
    }
  };

  let text = '';
  let finish: string | null = null;
  for (let round = 0; ; round++) {
    let reply;
    try {
      reply = await callWithRetry(toolsOn);
    } catch (error) {
      // A model without tool calling: remember it and answer from the digest and food block alone.
      if (toolsOn && error instanceof AiError && error.kind === 'noTools') {
        toolsOn = false;
        toolsUnsupported = true;
        deps.onNoTools?.();
        reply = await callWithRetry(false);
      } else throw error;
    }
    finish = reply.finish;
    if (reply.toolCalls.length === 0 || !toolsOn) {
      text = reply.text;
      break;
    }
    const calls: ToolCall[] = reply.toolCalls.slice(0, ANSWER_LIMITS.toolCallsPerRound);
    messages.push({ role: 'assistant', content: reply.text, toolCalls: calls, ...(reply.thinking ? { reasoning: reply.thinking } : {}) });
    // All calls of a round start together (they only read): the round takes as long as the slowest one.
    for (const toolCall of calls) deps.onEvent?.({ type: 'toolStart', id: toolCall.id, trace: { tool: isToolName(toolCall.name) ? toolCall.name : 'get_day', args: {} } });
    const outcomes = await Promise.all(
      calls.map(async (toolCall) => {
        const outcome = await runTool(toolCall, deps.data);
        deps.onEvent?.({ type: 'toolDone', id: toolCall.id, trace: outcome.trace, summary: outcome.summary });
        return outcome;
      }),
    );
    mark('tools-done', { n: calls.length });
    calls.forEach((toolCall, i) => {
      const outcome = outcomes[i]!;
      trace.push(outcome.trace);
      steps.push({ id: toolCall.id, trace: outcome.trace, summary: outcome.summary });
      messages.push({ role: 'tool', callId: toolCall.id, name: toolCall.name, content: outcome.content });
    });
    if (deps.signal?.aborted) throw new AiError('aborted');
    if (round + 1 >= ANSWER_LIMITS.toolRounds) {
      // The round limit is reached: ask for the answer without tools.
      toolsOn = false;
      messages.push({ role: 'user', content: 'Answer now with what you have, without more tool calls.' });
    }
  }

  const finished = finishReply(text, { text: deps.text, lastUserText: lastUser.content, mode, locale: deps.locale });
  mark('finished', { chars: finished?.length ?? 0, rounds, calls: spent.calls });
  if (finished === null) throw new AiError('empty', null, `finish_reason=${finish ?? 'none'}; the answer held only reasoning tags or markup (${text.length} chars)`);
  return { reply: finished, fixed: false, flagged: null, trace, steps, reasoning, usage: spent, toolsUnsupported, digest };
}
