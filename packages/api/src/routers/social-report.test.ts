import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { socialRouter } from "./social";

const { client, db } = await d1TestDb();

const POST = "11111111-1111-1111-1111-111111111111";
const COMMENT = "33333333-3333-3333-3333-333333333333";

await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES
    ('own', 'Owner', 'own@test.id', 'free'),
    ('ann', 'Ann', 'ann@test.id', 'free'),
    ('bob', 'Bob', 'bob@test.id', 'free');
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, handle)
    VALUES
    ('own', 1990, 'male', 170, 80, 72, '2030-01-01', 'light', 'owner'),
    ('ann', 1990, 'female', 160, 70, 62, '2030-01-01', 'light', 'ann_k'),
    ('bob', 1990, 'male', 175, 90, 80, '2030-01-01', 'light', 'bob_b');
  UPDATE profile SET public_profile = 1;
  INSERT INTO post (id, user_id, kind, title, visibility) VALUES ('${POST}', 'own', 'cerita', 'Halo', 'publik');
  INSERT INTO post_comment (id, post_id, user_id, body) VALUES ('${COMMENT}', '${POST}', 'own', 'hai');
`);

const as = (userId: string) => ({
  context: {
    db,
    env: {},
    locale: "id",
    waitUntil: () => {},
    session: { user: { id: userId } },
  } as unknown as Context,
});
const rows = async () =>
  (await client.execute(`SELECT post_id, comment_id, user_id, source, reason, note FROM social_report ORDER BY created_at, id`)).rows;

describe("social.report", () => {
  test("reports a post, a comment and a profile, each tagged with its source", async () => {
    await call(socialRouter.report, { postId: POST, reason: "spam" }, as("ann"));
    await call(socialRouter.report, { commentId: COMMENT, reason: "kasar", note: "kasar sekali", source: "joyofit" }, as("ann"));
    await call(socialRouter.report, { userId: "own", reason: "lainnya", source: "joyofit" }, as("bob"));
    const all = await rows();
    expect(all).toHaveLength(3);
    expect(all.map((r) => r.source).sort()).toEqual(["joyofit", "joyofit", "joyorogo"]);
    expect(all.find((r) => r.user_id === "own")).toMatchObject({ post_id: null, comment_id: null, reason: "lainnya" });
    expect(all.find((r) => r.comment_id === COMMENT)?.note).toBe("kasar sekali");
  });

  test("needs exactly one target", async () => {
    await expect(call(socialRouter.report, { reason: "spam" }, as("ann"))).rejects.toThrow();
    await expect(call(socialRouter.report, { postId: POST, userId: "own", reason: "spam" }, as("ann"))).rejects.toThrow();
  });

  test("refuses to report yourself or a member that does not exist", async () => {
    await expect(call(socialRouter.report, { userId: "ann", reason: "spam" }, as("ann"))).rejects.toThrow();
    await expect(call(socialRouter.report, { userId: "ghost", reason: "spam" }, as("ann"))).rejects.toThrow();
  });
});

describe("social.block for JoyoFit readers", () => {
  test("blocking hides the member's posts, comments and profile both ways, unblocking restores them", async () => {
    const feed = async (who: string) =>
      ((await call(socialRouter.feed, { tab: "jelajah" }, as(who))) as { items: { id: string }[] }).items.map((p) => p.id);
    expect(await feed("ann")).toContain(POST);
    await call(socialRouter.block, { userId: "own" }, as("ann"));

    expect(await feed("ann")).not.toContain(POST);
    const commentsFor = async (who: string) =>
      ((await call(socialRouter.comments, { postId: POST }, as(who)).catch(() => ({ items: [] }))) as { items: unknown[] }).items.length;
    expect(await commentsFor("bob")).toBe(1);
    expect(await commentsFor("ann")).toBe(0);
    await expect(call(socialRouter.publicProfile, { handle: "owner" }, as("ann"))).rejects.toThrow();
    const list = (await call(socialRouter.blockList, undefined, as("ann"))) as { id: string }[];
    expect(list.map((u) => u.id)).toEqual(["own"]);

    await call(socialRouter.unblock, { userId: "own" }, as("ann"));
    expect(await feed("ann")).toContain(POST);
    expect(await call(socialRouter.blockList, undefined, as("ann"))).toEqual([]);
  });
});
