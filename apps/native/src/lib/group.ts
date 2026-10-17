import { i18n, timeAgo } from "@joyorogo/i18n";
import { useQuery } from "@tanstack/react-query";
import type { AppRouterClient } from "@joyorogo/api/routers/index";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

import { shareUrl } from "./share-links";

type GroupDetailOutput = Awaited<ReturnType<AppRouterClient["group"]["detail"]>>;

/** One member card of group.detail, with today's numbers and streak. */
export type GroupMember = GroupDetailOutput["members"][number];

/** One feed event of group.activity (food | exercise | weight). */
export type GroupActivityEvent = Awaited<
  ReturnType<AppRouterClient["group"]["activity"]>
>[number];

/** One nudge received in group.inbox. */
export type InboxItem = Awaited<ReturnType<AppRouterClient["group"]["inbox"]>>[number];

/** varScan output: verdict, totals, and the member's shared foods. */
export type VarScan = Awaited<ReturnType<AppRouterClient["group"]["varScan"]>>;

/** varHistory output: own VAR perut scans, share flag, and the latest tape entry. */
export type VarHistory = Awaited<ReturnType<AppRouterClient["group"]["varHistory"]>>;

/** Public share link for an invite code (same shape as the web /gabung route), with UTM. */
export function inviteLink(code: string): string {
  return shareUrl(`/gabung/${code}`, "invite");
}

/** WhatsApp-ready invite: group name, code, link, and one sentence on why. */
export function inviteMessage(groupName: string, code: string): string {
  return `${i18n.t("grup:invite.shareText", { name: groupName, code })}\n${inviteLink(code)}`;
}

/**
 * Accepts a bare invite code or a pasted invite link — the share sheet on
 * the receiving phone often hands over the whole URL.
 */
export function extractInviteCode(raw: string): string {
  const text = raw.trim();
  const fromLink = text.match(/gabung\/([A-Za-z0-9]+)/i);
  return fromLink ? fromLink[1] : text.replace(/\s+/g, "");
}

/** Relative time in the active language ("5 menit lalu" / "5 minutes ago"); "never" for null. */
export function timeAgoId(input: string | Date | null | undefined): string {
  if (input === null || input === undefined) return i18n.t("grup:time.never");
  return timeAgo(input);
}

/** Unread colek/catatan count for badges; off until the session exists. */
export function useUnreadCount() {
  const { data: session } = authClient.useSession();
  return useQuery({
    ...orpc.group.unreadCount.queryOptions(),
    enabled: session != null,
    refetchInterval: 60_000,
  });
}
