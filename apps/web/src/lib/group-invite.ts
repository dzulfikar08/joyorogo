import { i18n } from "@joyorogo/i18n";

import { shareUrl } from "@/lib/share-links";

/** Invite link for a group; the code is case-insensitive server-side. */
export function inviteLink(code: string): string {
  return shareUrl(`/gabung/${code}`, "invite");
}

/** What lands in the chat: group name, code and one sentence on why (the link rides separately). */
export function inviteText(groupName: string, code: string): string {
  return i18n.t("grup:invite.shareText", { name: groupName, code });
}

/**
 * Opens the share sheet where the browser has one, otherwise copies the link.
 * Resolves "copied" only when the clipboard was used, so callers can toast
 * just then; a dismissed sheet resolves "dismissed".
 */
export async function shareInvite(
  groupName: string,
  code: string,
): Promise<"shared" | "copied" | "dismissed"> {
  const url = inviteLink(code);
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "JoyoRogo", text: inviteText(groupName, code), url });
      return "shared";
    } catch (error) {
      if ((error as Error).name === "AbortError") return "dismissed";
      throw error;
    }
  }
  await navigator.clipboard.writeText(`${inviteText(groupName, code)}\n${url}`);
  return "copied";
}
