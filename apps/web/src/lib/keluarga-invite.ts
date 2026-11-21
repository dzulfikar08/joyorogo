import { i18n } from "@joyorogo/i18n";

import { trackEvent } from "@/lib/analytics";
import { shareUrl } from "@/lib/share-links";

/** Joyo Keluarga seat invite link. Single use, 7 days; the code is case-insensitive server-side. */
export function keluargaInviteLink(code: string): string {
  return shareUrl(`/keluarga/${code}`, "invite");
}

/**
 * Share sheet where the browser has one, else the clipboard, like `shareInvite` for groups. Resolves "copied" only
 * when the clipboard was used, so the caller can toast just then.
 */
export async function shareKeluargaInvite(code: string): Promise<"shared" | "copied" | "dismissed"> {
  const url = keluargaInviteLink(code);
  const text = i18n.t("keluarga:screen.invite.shareText");
  // A plain counter: no code, no names (docs/pricing/joyo-keluarga.md section 6).
  trackEvent("keluarga_invite_sent");
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Joyo Keluarga", text, url });
      return "shared";
    } catch (error) {
      if ((error as Error).name === "AbortError") return "dismissed";
      throw error;
    }
  }
  await navigator.clipboard.writeText(`${text}\n${url}`);
  return "copied";
}
