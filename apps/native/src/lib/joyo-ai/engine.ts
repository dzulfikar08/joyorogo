// Ported from JoyoFit (watch-fit) src/features/ai/engine.ts, adapted for JoyoRogo.
import { ADAPTERS } from "@joyorogo/api/lib/joyo-ai/adapters/index";
import {
  answer,
  ANSWER_LIMITS,
  type Answer,
  type AnswerEvent,
} from "@joyorogo/api/lib/joyo-ai/answer";
import {
  CONSENT_VERSION,
  grantConsent,
  grantHostedConsent,
} from "@joyorogo/api/lib/joyo-ai/consent";
import {
  buildDigest,
  digestJson,
  gatherDigestSource,
  type Digest,
} from "@joyorogo/api/lib/joyo-ai/digest";
import { foodBlockFor } from "@joyorogo/api/lib/joyo-ai/food-block";
import { resolveModel } from "@joyorogo/api/lib/joyo-ai/models";
import type { Person } from "@joyorogo/api/lib/joyo-ai/person";
import { normalizeBaseUrl, PROVIDERS } from "@joyorogo/api/lib/joyo-ai/providers";
import type { ChatLine, SafetyText } from "@joyorogo/api/lib/joyo-ai/safety";
import {
  baseUrlFor,
  byokAccess,
  modelFor,
  parseFastFields,
  toolKey,
} from "@joyorogo/api/lib/joyo-ai/settings";
import { createToolData, rpcFromClient } from "@joyorogo/api/lib/joyo-ai/tool-data";
import { AiError, type ModelInfo, type ProviderId } from "@joyorogo/api/lib/joyo-ai/types";
import type { JoyoDone } from "@joyorogo/api/lib/joyo-ai/server-chat";
import { jakartaToday } from "@joyorogo/api/lib/engine";
import type { Locale } from "@joyorogo/i18n";

import { client } from "@/utils/orpc";

import { hostedMessages } from "./hosted-input";
import { joyoSettings, joyoUsage, joyoVault } from "./stores";

const nowSec = (): number => Math.floor(Date.now() / 1000);

/** The person's data over the app's own oRPC procedures, for the own-key engine only: nothing a health store wrote leaves the phone. */
const toolDataNow = () => createToolData(rpcFromClient(client), { today: () => jakartaToday(), engine: "byok" });

export interface AskInput {
  history: readonly ChatLine[];
  person: Person;
  locale: Locale;
  text: SafetyText;
  signal?: AbortSignal;
  onEvent?: (event: AnswerEvent) => void;
}

/**
 * One answer with the person's own key: the phone calls the provider directly (the key never goes to JoyoRogo), reading the diary
 * through the app's own procedures. The gate (age, consent, key, address) and the daily ceiling come before any provider call.
 */
export async function askOwnKey(
  input: AskInput,
): Promise<{ answer: Answer; provider: ProviderId; model: string }> {
  await joyoSettings.load();
  const settings = joyoSettings.getSnapshot().settings;
  const access = byokAccess(settings, input.person.ageYears);
  if (!access.ok) throw new AiError("blocked", null, access.reason);
  const key = await joyoVault.get(access.provider);
  if (!key) throw new AiError("blocked", null, "noKey");
  await joyoUsage.today();
  const preset = PROVIDERS[access.provider];
  const data = toolDataNow();
  const tk = toolKey(access.provider, access.model);
  const result = await answer(input.history, {
    adapter: ADAPTERS[preset.adapter],
    conn: { baseUrl: access.baseUrl, apiKey: key, model: access.model },
    person: input.person,
    locale: input.locale,
    text: input.text,
    gather: () => gatherDigestSource(data, input.person, input.locale),
    data,
    preseed: (text) => foodBlockFor(text, data),
    toolsEnabled: !settings.noTools.includes(tk),
    onNoTools: () =>
      void joyoSettings.update((s) => ({
        noTools: s.noTools.includes(tk) ? s.noTools : [...s.noTools, tk].slice(-50),
      })),
    // A provider call is counted before it runs, so the ceiling holds even when calls overlap.
    beforeCall: () => {
      if (joyoUsage.peek().calls >= joyoSettings.getSnapshot().settings.dailyCeiling)
        throw new AiError("blocked", null, "ceiling");
    },
    afterCall: (usage) => void joyoUsage.record(usage),
    fast: settings.fastMode,
    fastFields: parseFastFields(settings.fastFields) ?? undefined,
    signal: input.signal,
    onEvent: input.onEvent,
  });
  return { answer: result, provider: access.provider, model: access.model };
}

export interface HostedInput {
  history: readonly ChatLine[];
  locale: Locale;
  signal?: AbortSignal;
  onEvent?: (event: AnswerEvent) => void;
}

/**
 * One answer from JoyoRogo's hosted engine (Pro): the server reads the diary and answers, the events stream back as they happen.
 * Errors surface as the ORPCError the server threw (see `hostedFailure`); an aborted question stops waiting at once.
 */
export async function askHosted(input: HostedInput): Promise<JoyoDone> {
  const messages = hostedMessages(input.history);
  const events = await client.joyo.chat(
    { messages, locale: input.locale, today: jakartaToday(), consentVersion: CONSENT_VERSION },
    { signal: input.signal },
  );
  for await (const event of events) {
    if (event.type === "done") return event.result;
    input.onEvent?.(event);
  }
  // The stream ended without its last event: nothing usable arrived.
  throw new AiError("empty");
}

/** The one-time yes for the hosted engine (explicit tap plus "I am 18 or older"). */
export const grantHostedConsentNow = (): Promise<unknown> =>
  joyoSettings.update((s) => grantHostedConsent(s, nowSec()));

// ---- what is sent ----

/** The digest as it would be sent now, for "Lihat data yang dikirim" and the consent screen's sample. */
export async function previewDigest(
  person: Person,
  locale: Locale,
): Promise<{ digest: Digest; json: string }> {
  const data = toolDataNow();
  const digest = buildDigest(await gatherDigestSource(data, person, locale));
  return { digest, json: digestJson(digest) };
}

// ---- setup ----

export interface TestInput {
  provider: ProviderId;
  /** For `custom`: the endpoint the person typed. */
  baseUrl: string;
  apiKey: string;
  /** The model the person picked, or null to use the default / first listed. */
  model: string | null;
  signal?: AbortSignal;
}

export type TestResult =
  | { ok: true; model: string; models: ModelInfo[]; calls: number; tokens: number }
  | { ok: false; error: AiError };

/**
 * The key test: lists the provider's models, picks the model (the list decides, so a retired default never blocks), and sends ONE
 * tiny message ("reply OK"). No data of the person is sent. The key goes only to the provider's own host.
 */
export async function testProvider(input: TestInput): Promise<TestResult> {
  const preset = PROVIDERS[input.provider];
  const baseUrl = preset.customUrl ? normalizeBaseUrl(input.baseUrl) : preset.baseUrl;
  if (!baseUrl) return { ok: false, error: new AiError("badRequest", null, "url") };
  const adapter = ADAPTERS[preset.adapter];
  const opts = { signal: input.signal };
  let calls = 0;
  let models: ModelInfo[] = [];
  try {
    calls += 1;
    models = await adapter.listModels({ baseUrl, apiKey: input.apiKey }, opts);
  } catch (error) {
    // A server without a model list (some custom gateways) still may answer chat; a refused key or no network is final.
    if (!(error instanceof AiError)) throw error;
    if (["badKey", "forbidden", "quota", "network", "timeout", "aborted"].includes(error.kind))
      return { ok: false, error };
  }
  const model = resolveModel(input.provider, input.model, models);
  if (!model) return { ok: false, error: new AiError("modelNotFound", null, "no model") };
  try {
    calls += 1;
    const reply = await adapter.complete(
      { baseUrl, apiKey: input.apiKey, model },
      {
        model,
        system: "You are a connection test. Reply with the single word OK.",
        messages: [{ role: "user", content: "ping" }],
        maxTokens: 16,
      },
      opts,
    );
    return {
      ok: true,
      model,
      models,
      calls,
      tokens: (reply.usage?.inputTokens ?? 0) + (reply.usage?.outputTokens ?? 0),
    };
  } catch (error) {
    if (error instanceof AiError) return { ok: false, error };
    throw error;
  }
}

/**
 * Saves a tested provider: the key into the secure store first (when that fails nothing else changes), then the choice and the
 * person's explicit consent for this provider and endpoint. The own-key chat becomes the engine in use. Call only after the person
 * ticked both consent boxes and the test passed.
 */
export async function connectProvider(input: {
  provider: ProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<void> {
  const preset = PROVIDERS[input.provider];
  const baseUrl = preset.customUrl ? (normalizeBaseUrl(input.baseUrl) ?? "") : preset.baseUrl;
  await joyoVault.set(input.provider, input.apiKey);
  await joyoSettings.update((s) =>
    grantConsent(
      {
        ...s,
        engine: "byok",
        provider: input.provider,
        models: { ...s.models, [input.provider]: input.model },
        customBaseUrl: preset.customUrl ? baseUrl : s.customBaseUrl,
        keySaved: { ...s.keySaved, [input.provider]: true as const },
      },
      input.provider,
      baseUrl,
      nowSec(),
    ),
  );
}

/** Changes only the model of one provider (the key stays). */
export const chooseModel = (provider: ProviderId, model: string): Promise<unknown> =>
  joyoSettings.update((s) => ({ models: { ...s.models, [provider]: model } }));

/** The provider's model list for the picker, with the key from the secure store. Null when no key or address is available. */
export async function listProviderModels(provider: ProviderId): Promise<ModelInfo[] | null> {
  const settings = joyoSettings.getSnapshot().settings;
  const key = await joyoVault.get(provider);
  const baseUrl = baseUrlFor(settings, provider);
  if (!key || !baseUrl) return null;
  return ADAPTERS[PROVIDERS[provider].adapter].listModels({ baseUrl, apiKey: key });
}

export { modelFor };
