import { sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";

import { enqueueMany, notifyInBackground } from "./notify";
import type { NotifyEnv } from "./notify";
import type { PushApp } from "./push-link";

// Push events of the social and group features. Thin builders around lib/notify.ts; the routers call these after the
// row they describe is written. Event table and defaults: docs/push.md.

export type PushContext = { db: Database; env: NotifyEnv; waitUntil: (promise: Promise<unknown>) => void };

/** One new-post push per author and follower in this window, however often the author posts. */
export const POST_PUSH_WINDOW_MS = 6 * 3_600_000;
/** Followers one post notifies (the cron delivers them in batches). */
export const POST_FANOUT_MAX = 200;
const EXCERPT_MAX = 120;

/** A post made by the JoyoFit watch is "JoyoFit's": its kudos and comments go to the JoyoFit app when it is registered. */
export function postApp(statsJson: string | null): PushApp | undefined {
  if (!statsJson) return undefined;
  try {
    const stats = JSON.parse(statsJson) as { source?: unknown };
    return stats.source === "joyofit" ? "joyofit" : undefined;
  } catch {
    return undefined;
  }
}

export function pushKudos(
  context: PushContext,
  input: { postId: string; postTitle: string; statsJson: string | null; authorId: string; actorId: string; actorName: string; hourBucket: number },
): void {
  const app = postApp(input.statsJson);
  notifyInBackground(context, input.authorId, {
    category: "social",
    kind: "kudos",
    title: { key: "notify.social.kudos.title", params: { name: input.actorName } },
    body: { text: input.postTitle },
    link: { t: "post", postId: input.postId },
    ...(app ? { app } : {}),
    dedupeKey: `kudos:${input.postId}:${input.actorId}:${input.hourBucket}`,
    collapseKey: `kudos:${input.postId}`,
  });
}

export function pushComment(
  context: PushContext,
  input: {
    kind: "comment" | "reply";
    commentId: string;
    postId: string;
    statsJson: string | null;
    recipientId: string;
    actorName: string;
    body: string;
  },
): void {
  const app = postApp(input.statsJson);
  notifyInBackground(context, input.recipientId, {
    category: "social",
    kind: input.kind,
    title: { key: `notify.social.${input.kind}.title`, params: { name: input.actorName } },
    body: input.body.length > 0 ? { text: input.body.slice(0, EXCERPT_MAX) } : { key: "notify.social.comment.attachment" },
    link: { t: "post", postId: input.postId, commentId: input.commentId },
    ...(app ? { app } : {}),
    dedupeKey: `${input.kind}:${input.commentId}`,
  });
}

/** A new follower; at most one push per follower and day, however often they follow and unfollow. */
export function pushFollow(
  context: PushContext,
  input: { recipientId: string; actorId: string; actorName: string; actorHandle: string | null; day: string },
): void {
  notifyInBackground(context, input.recipientId, {
    category: "social",
    kind: "follow",
    title: { key: "notify.social.follow.title", params: { name: input.actorName } },
    body: { key: "notify.social.follow.body" },
    link: input.actorHandle ? { t: "profile", handle: input.actorHandle } : { t: "feed" },
    dedupeKey: `follow:${input.actorId}:${input.day}`,
  });
}

/**
 * New post -> the author's followers who may see it, can be reached, have Sosial on and did not already hear from this
 * author in the last six hours. Stored for the cron (up to 200); the daily cap and quiet hours apply at delivery.
 */
export function pushNewPost(
  context: PushContext,
  input: { postId: string; authorId: string; authorName: string; title: string; visibility: "publik" | "grup" },
): void {
  context.waitUntil(
    (async () => {
      const since = Date.now() - POST_PUSH_WINDOW_MS;
      const collapseKey = `post:${input.authorId}`;
      const recipients = await context.db.all<{ id: string }>(sql`
        SELECT f.follower_id AS id FROM social_follow f
        WHERE f.following_id = ${input.authorId}
          AND NOT EXISTS (
            SELECT 1 FROM social_block b
            WHERE (b.blocker_id = f.follower_id AND b.blocked_id = ${input.authorId})
               OR (b.blocker_id = ${input.authorId} AND b.blocked_id = f.follower_id))
          AND (${input.visibility} = 'publik' OR EXISTS (
            SELECT 1 FROM team_member a JOIN team_member c ON a.team_id = c.team_id
            WHERE a.user_id = f.follower_id AND c.user_id = ${input.authorId}))
          AND (EXISTS (SELECT 1 FROM push_device d WHERE d.user_id = f.follower_id)
            OR EXISTS (SELECT 1 FROM push_subscription s WHERE s.user_id = f.follower_id))
          AND COALESCE((SELECT p.social FROM push_prefs p WHERE p.user_id = f.follower_id), 1) = 1
          AND NOT EXISTS (
            SELECT 1 FROM push_outbox o
            WHERE o.user_id = f.follower_id AND o.kind = 'post' AND o.collapse_key = ${collapseKey} AND o.created_at > ${since})
        LIMIT ${POST_FANOUT_MAX}`);
      await enqueueMany({ db: context.db, env: context.env }, recipients.map((r) => r.id), () => ({
        category: "social",
        kind: "post",
        title: { key: "notify.social.post.title", params: { name: input.authorName } },
        body: { text: input.title },
        link: { t: "post", postId: input.postId },
        dedupeKey: `post:${input.postId}`,
        collapseKey,
      }));
    })().catch((error: unknown) => console.error("[push] new post fan-out failed", error)),
  );
}

/** Group poke or note: the person poked / written to. Poke has its own one-hour limit per pair; notes a daily quota. */
export function pushNudge(
  context: PushContext,
  input: {
    nudgeId: string;
    kind: "poke" | "note";
    toUserId: string;
    fromName: string;
    message: string | null;
  },
): void {
  notifyInBackground(context, input.toUserId, {
    category: "group",
    kind: input.kind,
    title: {
      key: input.kind === "poke" ? "notify.group.poke.title" : "notify.group.note.title",
      params: { name: input.fromName },
    },
    body: input.message ? { text: input.message } : { key: "notify.group.poke.body" },
    link: { t: "inbox" },
    dedupeKey: `nudge:${input.nudgeId}`,
  });
}
