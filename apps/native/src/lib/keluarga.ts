import { Platform, Share } from "react-native";

import { i18n } from "@joyorogo/i18n";

import { shareUrl } from "./share-links";

/**
 * Joyo Keluarga on native (docs/pricing/joyo-keluarga.md sections 4.3, 4.4 and 5).
 *
 * The server decides whether the plan exists at all (`/api/config.keluarga`, `household.get.enabled`, both off while
 * KELUARGA_ENABLED is off). On top of that the iOS paywall keeps the Keluarga switch hidden until App Review has
 * answered the cross-account question and the App Store products are live (phase 6): flip this constant in a store
 * build, never by OTA, because the paywall must match what review saw.
 */
export const KELUARGA_IOS_ENABLED = false;

/** App Store Connect subscriptions in group "JoyoRogo Pro", ranked above `founder.*`, Family Sharing off. */
export const KELUARGA_APPLE_PRODUCT_IDS = {
  monthly: "com.joyodigitama.joyorogo.keluarga.monthly",
  yearly: "com.joyodigitama.joyorogo.keluarga.yearly",
} as const;

/** Play Console subscription with base plans `monthly` and `yearly`, same package as `pro`. */
export const KELUARGA_PLAY_PRODUCT_ID = "keluarga";

/** Whether this platform may show the Pro / Keluarga switch at all (the server flag and store prices come on top). */
export function keluargaPlatformAllowed(os: string = Platform.OS): boolean {
  return os === "ios" ? KELUARGA_IOS_ENABLED : os === "android";
}

/** Public seat invite link (same shape as the web /keluarga/$code route), with UTM like group invites. */
export function keluargaInviteLink(code: string): string {
  return shareUrl(`/keluarga/${code}`, "invite");
}

/** A bare code or a pasted invite link: the receiving phone's share sheet often hands over the whole URL. */
export function extractKeluargaCode(raw: string): string {
  const text = raw.trim();
  const fromLink = text.match(/keluarga\/([A-Za-z0-9]+)/i);
  return fromLink ? fromLink[1]! : text.replace(/\s+/g, "");
}

/** The share sheet with the invite text and link. Single use, 7 days, so one link per person. */
export async function shareKeluargaInvite(code: string): Promise<void> {
  const text = i18n.t("keluarga:screen.invite.shareText");
  await Share.share({ message: `${text}\n${keluargaInviteLink(code)}` });
}
