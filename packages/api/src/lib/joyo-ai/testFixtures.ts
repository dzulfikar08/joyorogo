// Ported from JoyoFit (watch-fit) src/features/ai/testFixtures.ts, adapted for JoyoRogo.
// Fixtures shared by the Joyo AI tests (named *Fixtures so UI text scans skip it). No bun:test import.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Locale } from '@joyorogo/i18n';

import type { DigestSource } from './digest';
import type { Person } from './person';
import type { SafetyText } from './safety';
import type { DayData, ProfileData, ToolData } from './tool-data';
import type { Adapter, ModelReply, ModelRequest, ProviderConnection, ToolSpec } from './types';

export const TODAY = '2026-10-22';

export const adult: Person = { ageYears: 34, sex: 'male', heightCm: 172, goal: 'lose' };

/** Two tool specs the adapter tests round-trip; the real ones live in `tools.ts`. */
export const TEST_TOOL_SPECS: readonly ToolSpec[] = [
  { name: 'get_day', description: 'One day of the food log.', parameters: { type: 'object', properties: { date: { type: 'string' } } } },
  { name: 'get_targets', description: 'The daily targets.', parameters: { type: 'object', properties: {} } },
];

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that answers from a queue and records what was sent. */
export function mockFetch(answers: (Response | Error | ((call: FetchCall) => Response))[]): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const queue = [...answers];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const call: FetchCall = {
      url: String(url),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const next = queue.shift();
    if (next === undefined) throw new Error('no answer queued');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(call) : next;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

export const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** An adapter that answers from a queue of replies (or errors) and records the requests. */
export function scriptedAdapter(script: (ModelReply | Error)[]): Adapter & { requests: ModelRequest[]; conns: ProviderConnection[] } {
  const queue = [...script];
  const requests: ModelRequest[] = [];
  const conns: ProviderConnection[] = [];
  return {
    requests,
    conns,
    async complete(conn, request) {
      conns.push(conn);
      requests.push(request);
      const next = queue.shift();
      if (!next) throw new Error('script exhausted');
      if (next instanceof Error) throw next;
      return next;
    },
    async listModels() {
      return [];
    },
  };
}

export const textReply = (text: string): ModelReply => ({ text, thinking: '', toolCalls: [], usage: { inputTokens: 1000, outputTokens: 80 }, stop: 'end', finish: 'stop' });
export const toolReply = (...calls: { id: string; name: string; args: Record<string, unknown> }[]): ModelReply => ({ text: '', thinking: '', toolCalls: calls, usage: { inputTokens: 900, outputTokens: 30 }, stop: 'tools', finish: 'tool_calls' });

/** An in-memory `KeyValue` for the conversation store; `async` makes every call return a promise like the native file store. */
export function memoryKeyValue(opts: { async?: boolean } = {}) {
  const map = new Map<string, string>();
  const wrap = <T>(value: T): T | Promise<T> => (opts.async ? Promise.resolve(value) : value);
  return {
    get: (key: string) => wrap(map.get(key) ?? null),
    set: (key: string, value: string) => wrap(void map.set(key, value)),
    remove: (key: string) => wrap(void map.delete(key)),
    dump: (): Record<string, string> => Object.fromEntries(map),
    poke: (key: string, value: string) => void map.set(key, value),
  };
}

const emptyProfile: ProfileData = { ageYears: 34, sex: 'male', heightCm: 172, goal: 'lose', activityLevel: null, tdeeKcal: 2300, targetWeightKg: 70, targetDate: null, latestWeightKg: 72.4, scanAllowance: null };

export function dayData(date = TODAY): DayData {
  const sum = (g: number) => ({ g, missingRows: 0 });
  return {
    date,
    items: [{ meal: 'sarapan', name: 'Nasi putih', grams: 150, kcal: 195, protein: 4, carbs: 42, fat: 0.4, fiber: 0.6, scanned: false }],
    totals: { kcal: 195, protein: sum(4), carbs: sum(42), fat: sum(0.4), fiber: sum(0.6), rows: 1 },
    targets: { kcal: 1800, protein: 90, carbs: 220, fat: 60, fiber: 25 },
    remaining: { kcal: 1605, protein: 86, carbs: 178, fat: 59.6, fiber: 24.4 },
    remainingPartial: [],
    water: { glasses: 2, goal: 8 },
    fasting: null,
  };
}

/** A digest source with one logged day. */
export function sampleSource(over: Partial<DigestSource> = {}): DigestSource {
  return { now: TODAY, locale: 'id', person: adult, profile: emptyProfile, day: dayData(), days: [], weights: [], ...over };
}

/** A `ToolData` that answers from fixed data and records what was asked. */
export function fakeToolData(over: Partial<ToolData> = {}): ToolData & { calls: string[] } {
  const calls: string[] = [];
  const base: ToolData = {
    today: () => TODAY,
    async day(date) {
      calls.push(`day ${date}`);
      return dayData(date);
    },
    async range(from, to) {
      calls.push(`range ${from} ${to}`);
      return { days: [], notes: [] };
    },
    async weights(from) {
      calls.push(`weights ${from}`);
      return { entries: [], targetKg: null };
    },
    async profile() {
      calls.push('profile');
      return emptyProfile;
    },
  };
  return Object.assign({ ...base, ...over }, { calls });
}

/** The shared `joyoAi.json` of a locale, read from disk (JSON imports are not part of the api project). */
export function joyoAiStrings(locale: Locale): Record<string, unknown> & { disclaimerLine: string; refuseLeak: string; safe: SafetyText['safe'] } {
  return JSON.parse(readFileSync(join(import.meta.dir, '../../../../i18n/src/locales', locale, 'joyoAi.json'), 'utf8'));
}

export function safetyText(locale: Locale): SafetyText {
  const ai = joyoAiStrings(locale);
  return { disclaimer: ai.disclaimerLine, refuseLeak: ai.refuseLeak, safe: ai.safe };
}

export interface SafetyFixtures {
  injury: string[];
  medical: string[];
  eatingDisorder: string[];
  minorDiet: string[];
  extremeDietAdult: string[];
  condition: string[];
  normal: string[];
  maternal: string[];
  notMaternal: string[];
}

export const safetyFixtures = (): SafetyFixtures => JSON.parse(readFileSync(join(import.meta.dir, 'safety.fixtures.json'), 'utf8'));
