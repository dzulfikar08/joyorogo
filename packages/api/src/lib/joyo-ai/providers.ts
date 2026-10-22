// Ported from JoyoFit (watch-fit) src/features/ai/providers.ts, adapted for JoyoRogo.
import type { AdapterKind, ProviderId } from './types';

export interface ProviderPreset {
  id: ProviderId;
  adapter: AdapterKind;
  /** Without the trailing slash. Custom has none: the person enters it. */
  baseUrl: string;
  /** A small, cheap model that calls tools. The model list from the provider replaces it when the id is not there any more. */
  defaultModel: string;
  /** Models offered as one-tap choices before the provider's own list is loaded. */
  suggested: readonly string[];
  /** OpenAI moved to `max_completion_tokens`; the others still take `max_tokens`. */
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
  /** Gemini 3 models cannot switch reasoning off, so the default is `low` to keep answers fast and cheap. */
  reasoningEffort: 'low' | null;
  /** The provider's key page, opened from the setup screen. */
  keyUrl: string | null;
  /** Google's free tier uses what it receives to improve Google products; the setup screen says so. */
  freeTierTrainsOnData: boolean;
  /** The server accepts `stream_options.include_usage`, so a streamed answer still reports its tokens. Unknown servers may reject it. */
  streamUsage: boolean;
  /** The person types the endpoint (LiteLLM, Ollama on the LAN, a company gateway). */
  customUrl: boolean;
  /** Shown in the key field when empty. */
  keyPlaceholder: string;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  openrouter: {
    id: 'openrouter',
    adapter: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-haiku-5.5',
    suggested: ['anthropic/claude-haiku-5.5', 'openai/gpt-6-luna', 'google/gemini-3.8-flash'],
    maxTokensField: 'max_tokens',
    reasoningEffort: null,
    keyUrl: 'https://openrouter.ai/keys',
    freeTierTrainsOnData: false,
    streamUsage: true,
    customUrl: false,
    keyPlaceholder: 'sk-or-...',
  },
  openai: {
    id: 'openai',
    adapter: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-6-luna',
    suggested: ['gpt-6-luna', 'gpt-6.1-sol'],
    maxTokensField: 'max_completion_tokens',
    reasoningEffort: null,
    keyUrl: 'https://platform.openai.com/api-keys',
    freeTierTrainsOnData: false,
    streamUsage: true,
    customUrl: false,
    keyPlaceholder: 'sk-...',
  },
  anthropic: {
    id: 'anthropic',
    adapter: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-haiku-5-5',
    suggested: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
    maxTokensField: 'max_tokens',
    reasoningEffort: null,
    keyUrl: 'https://platform.claude.com/settings/keys',
    freeTierTrainsOnData: false,
    streamUsage: false,
    customUrl: false,
    keyPlaceholder: 'sk-ant-...',
  },
  gemini: {
    id: 'gemini',
    adapter: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.8-flash',
    suggested: ['gemini-3.8-flash'],
    maxTokensField: 'max_tokens',
    reasoningEffort: 'low',
    keyUrl: 'https://aistudio.google.com/apikey',
    freeTierTrainsOnData: true,
    streamUsage: true,
    customUrl: false,
    keyPlaceholder: 'AIza...',
  },
  custom: {
    id: 'custom',
    adapter: 'openai',
    baseUrl: '',
    defaultModel: '',
    suggested: [],
    maxTokensField: 'max_tokens',
    reasoningEffort: null,
    keyUrl: null,
    freeTierTrainsOnData: false,
    streamUsage: false,
    customUrl: true,
    keyPlaceholder: 'sk-...',
  },
};

/** Setup lists OpenRouter first: prepaid credits cap what a mistake can cost. */
export const PROVIDER_ORDER: readonly ProviderId[] = ['openrouter', 'openai', 'anthropic', 'gemini', 'custom'];

/** A base URL as the adapters use it: trimmed, no trailing slash. Null for anything that is not an http(s) URL. */
export function normalizeBaseUrl(raw: string): string | null {
  const url = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/?#]+/i.test(url)) return null;
  try {
    new URL(url);
  } catch {
    return null;
  }
  return url;
}

/** The host the consent is bound to: a custom endpoint is a different recipient from another one. */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.toLowerCase();
  } catch {
    return baseUrl;
  }
}

/** True for `http://` endpoints that are not on the phone's own network, where the key and the digest would cross the internet unencrypted. */
export function isInsecureRemote(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return true;
  }
  if (url.protocol === 'https:') return false;
  const host = url.hostname;
  return !(
    host === 'localhost' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith('.local')
  );
}
