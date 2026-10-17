import idAuth from "./locales/id/auth.json";
import idBerat from "./locales/id/berat.json";
import idBilling from "./locales/id/billing.json";
import idCommon from "./locales/id/common.json";
import idEmail from "./locales/id/email.json";
import idErrors from "./locales/id/errors.json";
import idMakan from "./locales/id/makan.json";
import idTidur from "./locales/id/tidur.json";
import idOlahraga from "./locales/id/olahraga.json";
import idOnboarding from "./locales/id/onboarding.json";
import idPush from "./locales/id/push.json";
import idSettings from "./locales/id/settings.json";
import idScan from "./locales/id/scan.json";
import idBarcode from "./locales/id/barcode.json";
import idVarperut from "./locales/id/varperut.json";
import idFeed from "./locales/id/feed.json";
import idPlace from "./locales/id/place.json";
import idChallenge from "./locales/id/challenge.json";
import idMisc from "./locales/id/misc.json";
import idTips from "./locales/id/tips.json";
import idHome from "./locales/id/home.json";
import idGrup from "./locales/id/grup.json";
import idMaternal from "./locales/id/maternal.json";

import enAuth from "./locales/en/auth.json";
import enBerat from "./locales/en/berat.json";
import enBilling from "./locales/en/billing.json";
import enCommon from "./locales/en/common.json";
import enEmail from "./locales/en/email.json";
import enErrors from "./locales/en/errors.json";
import enMakan from "./locales/en/makan.json";
import enTidur from "./locales/en/tidur.json";
import enOlahraga from "./locales/en/olahraga.json";
import enOnboarding from "./locales/en/onboarding.json";
import enPush from "./locales/en/push.json";
import enSettings from "./locales/en/settings.json";
import enScan from "./locales/en/scan.json";
import enBarcode from "./locales/en/barcode.json";
import enVarperut from "./locales/en/varperut.json";
import enFeed from "./locales/en/feed.json";
import enPlace from "./locales/en/place.json";
import enChallenge from "./locales/en/challenge.json";
import enMisc from "./locales/en/misc.json";
import enTips from "./locales/en/tips.json";
import enHome from "./locales/en/home.json";
import enGrup from "./locales/en/grup.json";
import enMaternal from "./locales/en/maternal.json";

import type { Locale } from "./locale";

/** Indonesian is the source: its JSON shapes the key types. */
const id = {
  auth: idAuth,
  berat: idBerat,
  billing: idBilling,
  common: idCommon,
  email: idEmail,
  errors: idErrors,
  makan: idMakan,
  tidur: idTidur,
  olahraga: idOlahraga,
  onboarding: idOnboarding,
  push: idPush,
  settings: idSettings,
  scan: idScan,
  barcode: idBarcode,
  varperut: idVarperut,
  feed: idFeed,
  place: idPlace,
  challenge: idChallenge,
  misc: idMisc,
  tips: idTips,
  home: idHome,
  grup: idGrup,
  maternal: idMaternal,
};

/**
 * English must carry every key of `id` (tsc fails otherwise); it may add plural
 * forms Indonesian does not have (`_one`).
 */
const en: typeof id = {
  auth: enAuth,
  berat: enBerat,
  billing: enBilling,
  common: enCommon,
  email: enEmail,
  errors: enErrors,
  makan: enMakan,
  tidur: enTidur,
  olahraga: enOlahraga,
  onboarding: enOnboarding,
  push: enPush,
  settings: enSettings,
  scan: enScan,
  barcode: enBarcode,
  varperut: enVarperut,
  feed: enFeed,
  place: enPlace,
  challenge: enChallenge,
  misc: enMisc,
  tips: enTips,
  home: enHome,
  grup: enGrup,
  maternal: enMaternal,
};

export const resources = { id, en } satisfies Record<Locale, typeof id>;

export type Resources = typeof id;
export type Namespace = keyof Resources;

export const NAMESPACES = Object.keys(id) as Namespace[];
export const DEFAULT_NAMESPACE = "common" satisfies Namespace;
