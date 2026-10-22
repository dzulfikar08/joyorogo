// Ported from JoyoFit (watch-fit) src/features/ai/access.test.ts, adapted for JoyoRogo.
import { describe, expect, test } from 'bun:test';

import { CONSENT_CATEGORIES, CONSENT_VERSION, consentFor, grantConsent, grantHostedConsent, hasConsent, hostedConsentOk, revokeConsent } from './consent';
import { isInsecureRemote, normalizeBaseUrl } from './providers';
import { baseUrlFor, byokAccess, defaultSettings, hostedAccess, modelFor, parseSettings, parseSettingsText, type AiSettings } from './settings';

const NOW = 1_792_000_000;
const OPENAI = 'https://api.openai.com/v1';

const ready = (over: Partial<AiSettings> = {}): AiSettings =>
  grantConsent({ ...defaultSettings, engine: 'byok', provider: 'openai', keySaved: { openai: true }, ...over }, 'openai', OPENAI, NOW);

describe('byokAccess: no provider call unless everything is in place', () => {
  test('all set: ok with the preset endpoint and the default model', () => {
    expect(byokAccess(ready(), 30)).toEqual({ ok: true, provider: 'openai', baseUrl: OPENAI, model: 'gpt-6-luna' });
    expect(byokAccess(ready({ models: { openai: 'gpt-x' } }), null)).toMatchObject({ ok: true, model: 'gpt-x' });
  });
  test('no provider', () => {
    expect(byokAccess(defaultSettings, 30)).toEqual({ ok: false, reason: 'noProvider' });
  });
  test('no consent', () => {
    expect(byokAccess({ ...defaultSettings, provider: 'openai', keySaved: { openai: true } }, 30)).toEqual({ ok: false, reason: 'noConsent' });
  });
  test('no key', () => {
    expect(byokAccess(ready({ keySaved: {} }), 30)).toEqual({ ok: false, reason: 'noKey' });
  });
  test('under 18 is off whatever else is set; an unknown age passes; 18 passes', () => {
    expect(byokAccess(ready(), 17)).toEqual({ ok: false, reason: 'minor' });
    expect(byokAccess(ready(), 0)).toEqual({ ok: false, reason: 'minor' });
    expect(byokAccess(ready(), 18).ok).toBe(true);
    expect(byokAccess(ready(), null).ok).toBe(true);
    expect(byokAccess(defaultSettings, 12)).toEqual({ ok: false, reason: 'minor' });
  });
  test('a bad or insecure custom URL is blocked before consent or key are looked at', () => {
    const custom = (customBaseUrl: string): AiSettings => ({ ...defaultSettings, provider: 'custom', customBaseUrl, keySaved: { custom: true } });
    expect(byokAccess(custom(''), 30)).toEqual({ ok: false, reason: 'badUrl' });
    expect(byokAccess(custom('not a url'), 30)).toEqual({ ok: false, reason: 'badUrl' });
    expect(byokAccess(custom('ftp://x.example.com'), 30)).toEqual({ ok: false, reason: 'badUrl' });
    expect(byokAccess(custom('http://api.example.com/v1'), 30)).toEqual({ ok: false, reason: 'badUrl' });
    expect(byokAccess(custom('https://gw.example.com/v1/'), 30)).toEqual({ ok: false, reason: 'noConsent' });
    expect(byokAccess(custom('http://192.168.1.20:11434/v1'), 30)).toEqual({ ok: false, reason: 'noConsent' });
  });
  test('consent is bound to the host: another custom endpoint asks again', () => {
    const a = grantConsent({ ...defaultSettings, provider: 'custom', customBaseUrl: 'https://a.example.com/v1', keySaved: { custom: true } }, 'custom', 'https://a.example.com/v1', NOW);
    expect(byokAccess(a, 30).ok).toBe(true);
    expect(byokAccess({ ...a, customBaseUrl: 'https://b.example.com/v1' }, 30)).toEqual({ ok: false, reason: 'noConsent' });
    expect(consentFor(a, 'custom', 'https://A.example.com/other')).not.toBeNull();
    expect(hasConsent(a, 'custom', 'https://b.example.com/v1')).toBe(false);
  });
  test('a consent of an older version asks again (the version bump), also for the hosted yes', () => {
    const old = ready();
    const stale: AiSettings = { ...old, consents: { openai: { ...old.consents.openai!, version: CONSENT_VERSION - 1 } }, hostedConsent: { version: CONSENT_VERSION - 1, at: NOW, adult: true } };
    expect(byokAccess(stale, 30)).toEqual({ ok: false, reason: 'noConsent' });
    expect(hostedAccess(stale, 30)).toEqual({ ok: false, reason: 'noConsent' });
    expect(hostedConsentOk(stale)).toBe(false);
  });
});

describe('hostedAccess', () => {
  test('needs the one-time hosted consent; minors are off', () => {
    expect(hostedAccess(defaultSettings, 30)).toEqual({ ok: false, reason: 'noConsent' });
    const granted = grantHostedConsent(defaultSettings, NOW);
    expect(granted.hostedConsent).toEqual({ version: CONSENT_VERSION, at: NOW, adult: true });
    expect(hostedAccess(granted, 30)).toEqual({ ok: true });
    expect(hostedAccess(granted, null)).toEqual({ ok: true });
    expect(hostedAccess(granted, 15)).toEqual({ ok: false, reason: 'minor' });
    expect(hostedAccess(defaultSettings, 15)).toEqual({ ok: false, reason: 'minor' });
  });
  test('an own-key consent does not open the hosted engine, and the reverse', () => {
    expect(hostedAccess(ready(), 30)).toEqual({ ok: false, reason: 'noConsent' });
    expect(byokAccess(grantHostedConsent(defaultSettings, NOW), 30).ok).toBe(false);
  });
});

describe('consent records', () => {
  test('grant and revoke are pure; the other providers are untouched', () => {
    const base = defaultSettings;
    const a = grantConsent(base, 'openai', OPENAI, NOW);
    const b = grantConsent(a, 'anthropic', 'https://api.anthropic.com', NOW);
    expect(base.consents).toEqual({});
    expect(Object.keys(revokeConsent(b, 'openai').consents)).toEqual(['anthropic']);
    expect(b.consents.openai).toMatchObject({ version: CONSENT_VERSION, host: 'api.openai.com', adult: true });
  });
  test('the consent screen lists the categories that leave the device', () => {
    expect(CONSENT_CATEGORIES).toEqual(['body', 'food', 'water', 'weight', 'fasting', 'chat']);
    expect(CONSENT_VERSION).toBe(2);
  });
});

describe('settings parsing', () => {
  test('defaults: hosted engine, ceiling 40, fast mode on', () => {
    expect(parseSettings(null)).toEqual(defaultSettings);
    expect(defaultSettings).toMatchObject({ engine: 'hosted', dailyCeiling: 40, fastMode: true, hostedConsent: null });
  });
  test('the ceiling is clamped to 5..200; bad values fall back one by one', () => {
    expect(parseSettings({ dailyCeiling: 1 }).dailyCeiling).toBe(5);
    expect(parseSettings({ dailyCeiling: 9999 }).dailyCeiling).toBe(200);
    expect(parseSettings({ dailyCeiling: 'x', engine: 'byok', provider: 'nope' })).toMatchObject({ dailyCeiling: 40, engine: 'byok', provider: null });
  });
  test('a round trip through JSON keeps everything; broken text is the defaults', () => {
    const s = grantHostedConsent(ready({ models: { openai: 'm' }, noTools: ['openai:m'] }), NOW);
    expect(parseSettingsText(JSON.stringify(s))).toEqual(s);
    expect(parseSettingsText('{oops')).toEqual(defaultSettings);
    expect(parseSettingsText(null)).toEqual(defaultSettings);
  });
  test('invalid consent records are dropped', () => {
    const parsed = parseSettings({ consents: { openai: { version: 1, at: 1, host: 'x', adult: false } }, hostedConsent: { version: 1, at: 1 } });
    expect(parsed.consents).toEqual({});
    expect(parsed.hostedConsent).toBeNull();
  });
  test('endpoints and models', () => {
    expect(baseUrlFor(defaultSettings, 'anthropic')).toBe('https://api.anthropic.com');
    expect(baseUrlFor({ ...defaultSettings, customBaseUrl: ' https://x.example.com/v1/ ' }, 'custom')).toBe('https://x.example.com/v1');
    expect(modelFor(defaultSettings, 'openai')).toBe('gpt-6-luna');
    expect(normalizeBaseUrl('x')).toBeNull();
    expect(isInsecureRemote('http://example.com')).toBe(true);
  });
});
