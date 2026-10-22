// Ported from JoyoFit (watch-fit) src/features/ai/{settings,access}.ts, adapted for JoyoRogo.
// Joyo AI settings as a plain JSON-serialisable record plus the pure gates in front of each engine. No storage here: the native app
// keeps the record in a file, never synced. The key itself is never in this record (only `keySaved`).
import { MIN_ADULT_AGE } from './person';
import { consentFor, hostedConsentOk } from './consent';
import { isInsecureRemote, normalizeBaseUrl, PROVIDERS } from './providers';
import { PROVIDER_IDS, type Engine, type ProviderId } from './types';

export interface ConsentRecord {
  /** `CONSENT_VERSION` the person said yes to. */
  version: number;
  /** Unix seconds. */
  at: number;
  /** The endpoint host the yes covers (a custom URL is a different recipient). */
  host: string;
  /** The person confirmed they are 18 or older. */
  adult: true;
}

/** The one-time yes for the hosted engine (JoyoRogo's own server, Workers AI). */
export interface HostedConsentRecord {
  version: number;
  at: number;
  adult: true;
}

export interface AiSettings {
  engine: Engine;
  provider: ProviderId | null;
  /** The chosen model per provider. */
  models: Partial<Record<ProviderId, string>>;
  /** The endpoint of the `custom` provider. */
  customBaseUrl: string;
  /** A key is stored for the provider (the key itself lives in the secure store). */
  keySaved: Partial<Record<ProviderId, true>>;
  consents: Partial<Record<ProviderId, ConsentRecord>>;
  hostedConsent: HostedConsentRecord | null;
  /** Ask thinking models to answer without long reasoning: faster and cheaper, sometimes less thorough. */
  fastMode: boolean;
  /** A JSON object sent in place of the built-in fast-mode fields (`{"reasoning_effort":"low"}`). Empty = the built-in ones. */
  fastFields: string;
  /** Provider calls per day the phone allows itself (tool rounds count). */
  dailyCeiling: number;
  /** `provider:model` pairs that answered "no tool calling": they run on the digest and food block alone. */
  noTools: string[];
}

export const DEFAULT_CEILING = 40;
export const MIN_CEILING = 5;
export const MAX_CEILING = 200;

export const defaultSettings: AiSettings = {
  engine: 'hosted',
  provider: null,
  models: {},
  customBaseUrl: '',
  keySaved: {},
  consents: {},
  hostedConsent: null,
  fastMode: true,
  fastFields: '',
  dailyCeiling: DEFAULT_CEILING,
  noTools: [],
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isProvider = (v: unknown): v is ProviderId => typeof v === 'string' && (PROVIDER_IDS as readonly string[]).includes(v);

/** Builds settings from stored JSON, keeping every field that is valid and falling back per field, so one bad value never loses the rest. */
export function parseSettings(value: unknown): AiSettings {
  if (!isObject(value)) return defaultSettings;
  const models: AiSettings['models'] = {};
  const keySaved: AiSettings['keySaved'] = {};
  const consents: AiSettings['consents'] = {};
  if (isObject(value.models)) for (const [k, v] of Object.entries(value.models)) if (isProvider(k) && typeof v === 'string' && v.length <= 200) models[k] = v;
  if (isObject(value.keySaved)) for (const [k, v] of Object.entries(value.keySaved)) if (isProvider(k) && v === true) keySaved[k] = true;
  if (isObject(value.consents)) {
    for (const [k, v] of Object.entries(value.consents)) {
      if (isProvider(k) && isObject(v) && typeof v.version === 'number' && typeof v.at === 'number' && typeof v.host === 'string' && v.adult === true) {
        consents[k] = { version: v.version, at: v.at, host: v.host, adult: true };
      }
    }
  }
  const hc = value.hostedConsent;
  const hostedConsent = isObject(hc) && typeof hc.version === 'number' && typeof hc.at === 'number' && hc.adult === true ? { version: hc.version, at: hc.at, adult: true as const } : null;
  const ceiling = typeof value.dailyCeiling === 'number' && Number.isFinite(value.dailyCeiling) ? Math.round(value.dailyCeiling) : DEFAULT_CEILING;
  return {
    engine: value.engine === 'byok' ? 'byok' : 'hosted',
    provider: isProvider(value.provider) ? value.provider : null,
    models,
    customBaseUrl: typeof value.customBaseUrl === 'string' ? value.customBaseUrl.slice(0, 300) : '',
    keySaved,
    consents,
    hostedConsent,
    // On unless the person turned it off: a thinking model that thinks for 30 s is the usual cause of a slow answer.
    fastMode: value.fastMode !== false,
    fastFields: typeof value.fastFields === 'string' ? value.fastFields.slice(0, 300) : '',
    dailyCeiling: Math.min(MAX_CEILING, Math.max(MIN_CEILING, ceiling)),
    noTools: Array.isArray(value.noTools) ? value.noTools.filter((x): x is string => typeof x === 'string').slice(-50) : [],
  };
}

/** Settings from the stored text; damaged or missing text is the defaults, never an error. */
export function parseSettingsText(text: string | null): AiSettings {
  if (text === null) return defaultSettings;
  try {
    return parseSettings(JSON.parse(text));
  } catch {
    return defaultSettings;
  }
}

export const toolKey = (provider: ProviderId, model: string): string => `${provider}:${model}`;

/** Fields a person's own fast-mode JSON may never set: they would change what is asked, not how hard the model thinks. */
const FORBIDDEN_FAST_KEYS = ['model', 'messages', 'stream', 'stream_options', 'tools', 'tool_choice', 'max_tokens', 'max_completion_tokens', 'n', 'functions', 'function_call'];

/** The fast-mode fields the person typed: a JSON object without the forbidden keys, or null (empty, broken, or not an object). */
export function parseFastFields(text: string): Record<string, unknown> | null {
  if (text.trim() === '') return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!FORBIDDEN_FAST_KEYS.includes(k)) out[k] = v;
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

// ---- gates ----

/** Why the phone will not call the person's own provider; nothing is sent while this is set. */
export type ByokBlock = 'minor' | 'noProvider' | 'badUrl' | 'noKey' | 'noConsent';

export type ByokAccess = { ok: true; provider: ProviderId; baseUrl: string; model: string } | { ok: false; reason: ByokBlock };

/** Why the hosted engine will not be called from here (the server checks again: age from the profile, cap, Pro). */
export type HostedBlock = 'minor' | 'noConsent';

export type HostedAccess = { ok: true } | { ok: false; reason: HostedBlock };

/** The endpoint of a provider as the phone calls it: the preset, or the custom URL the person typed. Null when that URL is unusable. */
export function baseUrlFor(settings: AiSettings, provider: ProviderId): string | null {
  return PROVIDERS[provider].customUrl ? normalizeBaseUrl(settings.customBaseUrl) : PROVIDERS[provider].baseUrl;
}

export function modelFor(settings: AiSettings, provider: ProviderId): string {
  return settings.models[provider] ?? PROVIDERS[provider].defaultModel;
}

/**
 * The one gate in front of every own-key provider call (a key test sends no data, so it never passes here).
 * Under 18 is off whatever else is set. An unknown age is allowed, the person confirmed 18+ in the consent, and the prompt then
 * uses the conservative block.
 */
export function byokAccess(settings: AiSettings, ageYears: number | null): ByokAccess {
  if (ageYears !== null && ageYears < MIN_ADULT_AGE) return { ok: false, reason: 'minor' };
  const provider = settings.provider;
  if (!provider) return { ok: false, reason: 'noProvider' };
  const baseUrl = baseUrlFor(settings, provider);
  if (!baseUrl || isInsecureRemote(baseUrl)) return { ok: false, reason: 'badUrl' };
  if (!settings.keySaved[provider]) return { ok: false, reason: 'noKey' };
  if (!consentFor(settings, provider, baseUrl)) return { ok: false, reason: 'noConsent' };
  return { ok: true, provider, baseUrl, model: modelFor(settings, provider) };
}

/** The gate in front of the hosted engine on the client: age and the one-time consent for the current `CONSENT_VERSION`. */
export function hostedAccess(settings: AiSettings, ageYears: number | null): HostedAccess {
  if (ageYears !== null && ageYears < MIN_ADULT_AGE) return { ok: false, reason: 'minor' };
  if (!hostedConsentOk(settings)) return { ok: false, reason: 'noConsent' };
  return { ok: true };
}
