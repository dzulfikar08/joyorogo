// Ported from JoyoFit (watch-fit) src/features/ai/settings.test.ts, adapted for JoyoRogo.
import { describe, expect, test } from 'bun:test';

import { buildOpenAiBody, openAiAdapter, resetStreamMemory } from './adapters/openai';
import { parseFastFields, parseSettings } from './settings';
import { json, mockFetch } from './testFixtures';

const ask = { model: 'm', system: 'S', messages: [{ role: 'user' as const, content: 'x' }], maxTokens: 800 };

describe('fast-mode fields typed by the person', () => {
  test('a JSON object is accepted; anything else, and fields that change what is asked, are not', () => {
    expect(parseFastFields('{"reasoning_effort":"low"}')).toEqual({ reasoning_effort: 'low' });
    expect(parseFastFields(' {"thinking":{"type":"disabled"},"model":"evil","messages":[],"stream":false} ')).toEqual({ thinking: { type: 'disabled' } });
    expect(parseFastFields('')).toBeNull();
    expect(parseFastFields('not json')).toBeNull();
    expect(parseFastFields('[1]')).toBeNull();
    expect(parseFastFields('"x"')).toBeNull();
    expect(parseFastFields('{"model":"x"}')).toBeNull();
  });
  test('they replace the built-in fields, on any provider', () => {
    const custom = buildOpenAiBody('https://gateway.example.com/v1', { ...ask, fast: true, fastFields: { reasoning_effort: 'low' } });
    expect(custom).toMatchObject({ reasoning_effort: 'low' });
    expect(buildOpenAiBody('https://gateway.example.com/v1', { ...ask, fast: true, fastFields: { thinking: { type: 'disabled' } } })).not.toHaveProperty('reasoning_effort');
    expect(buildOpenAiBody('https://gateway.example.com/v1', { ...ask, fast: true })).toMatchObject({ reasoning_effort: 'low' });
    expect(buildOpenAiBody('https://gateway.example.com/v1', ask)).not.toHaveProperty('thinking');
  });
  test('sent over the wire, and dropped again when the server refuses them', async () => {
    resetStreamMemory();
    const { fetchImpl, calls } = mockFetch([json({ error: { message: 'bad field' } }, 400), json({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] })]);
    await openAiAdapter.complete({ baseUrl: 'https://gateway.example.com/v1', apiKey: 'sk-test-0123456789', model: 'm' }, { ...ask, fast: true, fastFields: { reasoning_effort: 'low' } }, { fetchImpl });
    expect(calls[0]!.body).toMatchObject({ reasoning_effort: 'low' });
    expect(calls[1]!.body).not.toHaveProperty('reasoning_effort');
  });
  test('settings keep the text, capped, and default to empty', () => {
    expect(parseSettings({}).fastFields).toBe('');
    expect(parseSettings({ fastFields: 'x'.repeat(500) }).fastFields).toHaveLength(300);
    expect(parseSettings({ fastMode: true }).fastMode).toBe(true);
    expect(parseSettings({ fastMode: false }).fastMode).toBe(false);
    // on by default (also for settings saved before the switch existed)
    expect(parseSettings({}).fastMode).toBe(true);
  });
});
