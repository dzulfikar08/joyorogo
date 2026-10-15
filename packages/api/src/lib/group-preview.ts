import { count, eq } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { team, teamMember } from "@joyorogo/db/schema/social";

import { normalizeInviteCode } from "./group";

/** Workers Rate Limiting binding surface (wrangler.jsonc `ratelimits`). */
export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

/**
 * What a group invite link may show to someone who is not (yet) a member:
 * the group's name and how many people are in it. Nothing else leaves here,
 * not member names, avatars, owner, or the invite code itself.
 */
export type PublicGroupPreview = { id: string; name: string; memberCount: number };

export async function loadPublicGroupPreview(
  db: Database,
  rawCode: string,
): Promise<PublicGroupPreview | null> {
  const code = normalizeInviteCode(rawCode);
  if (code === "") return null;
  const [row] = await db
    .select({ id: team.id, name: team.name })
    .from(team)
    .where(eq(team.inviteCode, code))
    .limit(1);
  if (!row) return null;
  const [members] = await db
    .select({ total: count() })
    .from(teamMember)
    .where(eq(teamMember.teamId, row.id));
  return { id: row.id, name: row.name, memberCount: members?.total ?? 0 };
}

/**
 * Per-client budget for the unauthenticated invite preview. Without the
 * binding (self-host, tests) or a client IP there is nothing to key on, so it
 * allows the call: codes are 8 random characters, so guessing one is not a
 * practical attack; the limit just keeps scripted probing cheap to refuse.
 */
export async function previewAllowed(
  limiter: RateLimitBinding | undefined,
  clientIp: string | null | undefined,
): Promise<boolean> {
  if (!limiter || !clientIp) return true;
  const { success } = await limiter.limit({ key: clientIp });
  return success;
}
