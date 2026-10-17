import idBerat from "./locales/id/berat.json";
import idCommon from "./locales/id/common.json";
import idEmail from "./locales/id/email.json";
import idErrors from "./locales/id/errors.json";
import idMakan from "./locales/id/makan.json";
import idPush from "./locales/id/push.json";
import idSettings from "./locales/id/settings.json";

import enBerat from "./locales/en/berat.json";
import enCommon from "./locales/en/common.json";
import enEmail from "./locales/en/email.json";
import enErrors from "./locales/en/errors.json";
import enMakan from "./locales/en/makan.json";
import enPush from "./locales/en/push.json";
import enSettings from "./locales/en/settings.json";

import type { Locale } from "./locale";

/** Indonesian is the source: its JSON shapes the key types. */
const id = {
  berat: idBerat,
  common: idCommon,
  email: idEmail,
  errors: idErrors,
  makan: idMakan,
  push: idPush,
  settings: idSettings,
};

/**
 * English must carry every key of `id` (tsc fails otherwise); it may add plural
 * forms Indonesian does not have (`_one`).
 */
const en: typeof id = {
  berat: enBerat,
  common: enCommon,
  email: enEmail,
  errors: enErrors,
  makan: enMakan,
  push: enPush,
  settings: enSettings,
};

export const resources = { id, en } satisfies Record<Locale, typeof id>;

export type Resources = typeof id;
export type Namespace = keyof Resources;

export const NAMESPACES = Object.keys(id) as Namespace[];
export const DEFAULT_NAMESPACE = "common" satisfies Namespace;
