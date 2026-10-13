import { useQuery } from "@tanstack/react-query";
import type { AppRouterClient } from "@joyorogo/api/routers/index";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Public share link for an invite code (same shape as the web /gabung route). */
export function inviteLink(code: string): string {
  return `https://joyorogo.com/gabung/${code}`;
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

/** "baru saja", "5 mnt lalu", "2 jam lalu", "3 hari lalu", "2 mgg lalu". */
export function timeAgoId(input: string | Date | null | undefined): string {
  if (input === null || input === undefined) return "belum pernah";
  const diff = Date.now() - new Date(input).getTime();
  if (diff < MINUTE_MS) return "baru saja";
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)} mnt lalu`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)} jam lalu`;
  if (diff < 14 * DAY_MS) return `${Math.floor(diff / DAY_MS)} hari lalu`;
  return `${Math.floor(diff / (7 * DAY_MS))} mgg lalu`;
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
