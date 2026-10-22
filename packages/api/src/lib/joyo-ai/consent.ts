// Ported from JoyoFit (watch-fit) src/features/ai/consent.ts, adapted for JoyoRogo.
import { hostOf } from './providers';
import type { AiSettings, ConsentRecord } from './settings';
import type { ProviderId } from './types';

/**
 * The version of the consent text and of the list of data the digest sends. Change what the digest sends (`DIGEST_FIELDS`, owned by
 * `digest.ts`, pinned there to this number) and bump this together: everyone is asked again (Apple 5.1.2(i), Google Play AI rules).
 * 2: the own-key engine no longer gets Health Connect / Apple Health data (the digest fields are unchanged; the consent wording now
 * lists it under "never sent", so earlier own-key yeses are asked again).
 */
export const CONSENT_VERSION = 2;

/** The kinds of data that leave the device, in the order the consent screen lists them (`joyoAiApp:consent.data.<id>`). */
export const CONSENT_CATEGORIES = ['body', 'food', 'water', 'weight', 'fasting', 'chat'] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

/** The yes for one own-key provider endpoint, or null (none, an older version, or another host). */
export function consentFor(settings: AiSettings, provider: ProviderId, baseUrl: string): ConsentRecord | null {
  const record = settings.consents[provider];
  if (!record || record.version !== CONSENT_VERSION) return null;
  return record.host === hostOf(baseUrl) ? record : null;
}

export const hasConsent = (settings: AiSettings, provider: ProviderId, baseUrl: string): boolean => consentFor(settings, provider, baseUrl) !== null;

/** Settings with the yes of one person for one provider endpoint (explicit tap, plus "I am 18 or older"). */
export function grantConsent(settings: AiSettings, provider: ProviderId, baseUrl: string, nowSec: number): AiSettings {
  return { ...settings, consents: { ...settings.consents, [provider]: { version: CONSENT_VERSION, at: nowSec, host: hostOf(baseUrl), adult: true as const } } };
}

/** Settings with the one-time yes for the hosted engine. */
export function grantHostedConsent(settings: AiSettings, nowSec: number): AiSettings {
  return { ...settings, hostedConsent: { version: CONSENT_VERSION, at: nowSec, adult: true as const } };
}

/** Settings without the yes of one provider (the key is deleted by the caller). */
export function revokeConsent(settings: AiSettings, provider: ProviderId): AiSettings {
  const { [provider]: _removed, ...rest } = settings.consents;
  return { ...settings, consents: rest };
}

/** The hosted yes exists and is for the current version (a bump asks again). */
export const hostedConsentOk = (settings: AiSettings): boolean => settings.hostedConsent !== null && settings.hostedConsent.version === CONSENT_VERSION;
