import { d1TestDb } from "@joyorogo/db/test-d1";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { aiUsage } from "@joyorogo/db/schema/fitness";
import { threadsAccount, threadsMention } from "@joyorogo/db/schema/threads";

import { botConfig } from "./config";
import type { BotConfig } from "./config";
import { FakeGraph, IMAGE_URL, OWN, analysis, threadsTime, visionFailure } from "./fixtures";
import type { ThreadsMedia } from "./graph";
import {
  approveDraft,
  editDraft,
  pollMentions,
  processMention,
  rejectDraft,
  sweepReceived,
} from "./pipeline";
import type { BotDeps } from "./pipeline";
import { MAX_REPLY_CHARS, REPLY_LINK, UNCLEAR_REPLY } from "./reply";
import { getMention } from "./store";

const { client, db } = await d1TestDb();
const graph = new FakeGraph();
graph.install();
afterAll(() => graph.uninstall());

const NOW = Date.parse("2026-10-27T05:00:00Z");
let clock = NOW;
let scans = 0;
let scanImpl: BotDeps["scan"];
const plate = () =>
  analysis([
    { name: "Nasi goreng", kcal: 500, confidence: 0.8 },
    { name: "Telur mata sapi", kcal: 90, confidence: 0.7 },
  ]);

function config(over: Record<string, string> = {}): BotConfig {
  return botConfig({ THREADS_BOT_MODE: "review", THREADS_ACCESS_TOKEN: "seed-token", ...over });
}
const deps = (cfg = config()): BotDeps => ({
  db,
  config: cfg,
  scan: async (image) => {
    scans += 1;
    return scanImpl(image);
  },
  now: () => clock,
  publishRetryMs: 1,
});

let n = 0;
/** A top-level post with an image, as the mentions edge returns it. */
function imagePost(over: Partial<ThreadsMedia> = {}): ThreadsMedia {
  n += 1;
  return graph.add({
    id: `m${n}`,
    username: `user${n}`,
    media_type: "IMAGE",
    media_url: IMAGE_URL,
    permalink: `https://www.threads.com/@user${n}/post/${n}`,
    timestamp: threadsTime(clock),
    is_reply: false,
    ...over,
  });
}

async function rowOf(id: string) {
  return (await getMention(db, id))!;
}

beforeEach(async () => {
  graph.reset();
  clock = NOW;
  scans = 0;
  scanImpl = async () => plate();
  await client.execute(`DELETE FROM threads_mention`);
  await client.execute(`DELETE FROM threads_account`);
  await client.execute(`DELETE FROM ai_usage`);
});

describe("kill switch", () => {
  test("off (and unset) does nothing: no row, no Graph call, no model", async () => {
    for (const mode of ["off", "", "garbage"]) {
      const post = imagePost();
      expect(await processMention(deps(config({ THREADS_BOT_MODE: mode })), post)).toEqual({
        status: "off",
      });
      expect(await getMention(db, post.id)).toBeNull();
    }
    expect(await pollMentions(deps(config({ THREADS_BOT_MODE: "off" })))).toEqual({
      polled: 0,
      handled: 0,
    });
    expect(await sweepReceived(deps(config({ THREADS_BOT_MODE: "off" })))).toBe(0);
    expect(scans).toBe(0);
    expect(graph.calls).toHaveLength(0);
    expect(graph.imageFetches).toBe(0);
  });
});

describe("review mode", () => {
  test("a mention with a photo is scanned in memory and queued as a draft with kcal ranges", async () => {
    const post = imagePost();
    const outcome = await processMention(deps(), post);
    expect(outcome).toEqual({ status: "pending_review", kind: "estimate" });
    expect(scans).toBe(1);
    expect(graph.imageFetches).toBe(1);
    expect(graph.published).toHaveLength(0);

    const row = await rowOf(post.id);
    expect(row.status).toBe("pending_review");
    expect(row.authorUsername).toBe(post.username!);
    expect(row.sourceMediaId).toBe(post.id);
    expect(row.mode).toBe("review");
    expect(row.kcalLow).toBe(470);
    expect(row.kcalHigh).toBe(710);
    expect(JSON.parse(row.dishesJson!)).toEqual([
      { name: "Nasi goreng", kcal: 500, low: 400, high: 600 },
      { name: "Telur mata sapi", kcal: 90, low: 70, high: 110 },
    ]);
    expect(row.replyText!.length).toBeLessThanOrEqual(MAX_REPLY_CHARS);
    expect(row.replyText).toContain("400–600 kcal");
    expect(row.replyText).toContain(REPLY_LINK);
    expect(row.scannedAt).not.toBeNull();
  });

  test("stores no photo and no post text: the row has only ids, names, ranges, status and times", async () => {
    const post = imagePost({ text: "makan siang @joyorogo" });
    await processMention(deps(), post);
    const row = await rowOf(post.id);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(IMAGE_URL);
    expect(serialized).not.toContain("makan siang");
    expect(Object.keys(row).sort()).toEqual(
      [
        "mediaId",
        "authorUsername",
        "sourceMediaId",
        "status",
        "skipReason",
        "kind",
        "dishesJson",
        "kcalLow",
        "kcalHigh",
        "replyText",
        "mode",
        "replyMediaId",
        "attempts",
        "error",
        "scannedAt",
        "reviewedBy",
        "reviewedAt",
        "sentAt",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
  });

  test("the scan is logged to the ai_usage ledger as 'threads' without a user", async () => {
    await processMention(deps(), imagePost());
    const rows = await db.select().from(aiUsage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scanType: "threads", userId: null, model: "@cf/test/vision" });
  });
});

describe("idempotency by media id", () => {
  test("the same mention delivered twice is scanned and queued once", async () => {
    const post = imagePost();
    expect((await processMention(deps(), post)).status).toBe("pending_review");
    expect(await processMention(deps(), post)).toEqual({ status: "duplicate" });
    expect(scans).toBe(1);
    expect(await db.select().from(threadsMention)).toHaveLength(1);
  });

  test("five concurrent deliveries (webhook retries racing the poll) make one scan", async () => {
    const post = imagePost();
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => processMention(deps(), post)),
    );
    expect(outcomes.filter((o) => o.status === "pending_review")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "duplicate")).toHaveLength(4);
    expect(scans).toBe(1);
  });

  test("a skipped mention stays skipped when it comes again", async () => {
    const post = imagePost({ media_type: "TEXT_POST", media_url: undefined });
    expect((await processMention(deps(), post)).status).toBe("skipped");
    expect((await processMention(deps(), post)).status).toBe("duplicate");
  });
});

describe("filters run before any model call", () => {
  test("no image: a text post, a video, a repost", async () => {
    for (const media_type of ["TEXT_POST", "VIDEO", "REPOST_FACADE"]) {
      const post = imagePost({
        media_type,
        media_url: media_type === "VIDEO" ? "https://scontent.cdninstagram.com/v.mp4" : undefined,
      });
      expect(await processMention(deps(), post)).toEqual({ status: "skipped", reason: "no_image" });
      expect((await rowOf(post.id)).skipReason).toBe("no_image");
    }
    expect(scans).toBe(0);
    expect(graph.imageFetches).toBe(0);
  });

  test("a text reply under someone's photo uses the parent's photo", async () => {
    const parent = imagePost({ username: "alice" });
    const reply = graph.add({
      id: "reply-1",
      username: "bob",
      media_type: "TEXT_POST",
      is_reply: true,
      replied_to: { id: parent.id },
      root_post: { id: parent.id, username: "alice" },
      timestamp: threadsTime(clock),
    });
    expect((await processMention(deps(), reply)).status).toBe("pending_review");
    expect(scans).toBe(1);
    const row = await rowOf(reply.id);
    expect(row.authorUsername).toBe("bob");
    expect(row.sourceMediaId).toBe(parent.id);
  });

  test("a text reply under a text post has no image", async () => {
    const parent = graph.add({
      id: "p-text",
      username: "alice",
      media_type: "TEXT_POST",
      timestamp: threadsTime(clock),
    });
    const reply = graph.add({
      id: "r-text",
      username: "bob",
      media_type: "TEXT_POST",
      is_reply: true,
      replied_to: { id: parent.id },
      root_post: { id: parent.id, username: "alice" },
      timestamp: threadsTime(clock),
    });
    expect(await processMention(deps(), reply)).toEqual({ status: "skipped", reason: "no_image" });
    expect(scans).toBe(0);
  });

  test("a carousel is scanned on its first image child", async () => {
    graph.add({
      id: "c1",
      media_type: "VIDEO",
      media_url: "https://scontent.cdninstagram.com/c1.mp4",
    });
    graph.add({ id: "c2", media_type: "IMAGE", media_url: IMAGE_URL });
    const post = imagePost({
      media_type: "CAROUSEL_ALBUM",
      media_url: undefined,
      children: { data: [{ id: "c1" }, { id: "c2" }] },
    });
    expect((await processMention(deps(), post)).status).toBe("pending_review");
    expect(scans).toBe(1);
    expect(graph.imageFetches).toBe(1);
  });

  test("a carousel of videos only has no image", async () => {
    graph.add({
      id: "v1",
      media_type: "VIDEO",
      media_url: "https://scontent.cdninstagram.com/v1.mp4",
    });
    const post = imagePost({
      media_type: "CAROUSEL_ALBUM",
      media_url: undefined,
      children: { data: [{ id: "v1" }] },
    });
    expect(await processMention(deps(), post)).toEqual({ status: "skipped", reason: "no_image" });
  });

  test("a webhook value without media_type is read whole from Threads first", async () => {
    const full = imagePost();
    const thin: ThreadsMedia = { id: full.id, username: full.username, timestamp: full.timestamp };
    expect((await processMention(deps(), thin)).status).toBe("pending_review");
    expect(scans).toBe(1);
  });

  test("our own post is ignored", async () => {
    const post = imagePost({ username: OWN.username });
    expect(await processMention(deps(), post)).toEqual({ status: "skipped", reason: "own_post" });
    const upper = imagePost({ username: "JoyoRogo" });
    expect(await processMention(deps(), upper)).toEqual({ status: "skipped", reason: "own_post" });
    expect(scans).toBe(0);
  });

  test("a mention inside a thread rooted at our post is ignored", async () => {
    const post = imagePost({
      is_reply: true,
      replied_to: { id: "ours-1" },
      root_post: { id: "ours-1", username: OWN.username, owner_id: OWN.id },
    });
    graph.add({ id: "ours-1", username: OWN.username, media_type: "TEXT_POST" });
    expect(await processMention(deps(), post)).toEqual({ status: "skipped", reason: "own_thread" });
    expect(scans).toBe(0);
  });

  test("a root known only by id is looked up; ours is ignored", async () => {
    graph.add({ id: "ours-2", username: OWN.username, media_type: "IMAGE", media_url: IMAGE_URL });
    const post = imagePost({
      is_reply: true,
      replied_to: { id: "ours-2" },
      root_post: { id: "ours-2" },
    });
    expect(await processMention(deps(), post)).toEqual({ status: "skipped", reason: "own_thread" });
  });

  test("a reply to one of OUR replies (our reply chain) is ignored even with its own photo", async () => {
    const ourReply = graph.add({
      id: "our-reply",
      username: OWN.username,
      media_type: "TEXT_POST",
      is_reply: true,
      replied_to: { id: "user-post" },
      root_post: { id: "user-post", username: "alice" },
    });
    const post = imagePost({
      is_reply: true,
      replied_to: { id: ourReply.id },
      root_post: { id: "user-post", username: "alice" },
    });
    expect(await processMention(deps(), post)).toEqual({ status: "skipped", reason: "own_thread" });
    expect(scans).toBe(0);
  });

  test("older than a day is stale, never scanned", async () => {
    const post = imagePost({ timestamp: threadsTime(clock, 25 * 3_600_000) });
    expect(await processMention(deps(), post)).toEqual({ status: "skipped", reason: "stale" });
    expect(scans).toBe(0);
  });

  test("a second mention on a photo that is already being answered is skipped", async () => {
    const parent = imagePost({ username: "alice" });
    const mk = (id: string, who: string) =>
      graph.add({
        id,
        username: who,
        media_type: "TEXT_POST",
        is_reply: true,
        replied_to: { id: parent.id },
        root_post: { id: parent.id, username: "alice" },
        timestamp: threadsTime(clock),
      });
    expect((await processMention(deps(), mk("t1", "bob"))).status).toBe("pending_review");
    expect(await processMention(deps(), mk("t2", "carol"))).toEqual({
      status: "skipped",
      reason: "duplicate_photo",
    });
    expect(scans).toBe(1);
  });

  test("a photo that was not food does not block the next mention on it", async () => {
    const parent = imagePost({ username: "alice" });
    const mk = (id: string, who: string) =>
      graph.add({
        id,
        username: who,
        media_type: "TEXT_POST",
        is_reply: true,
        replied_to: { id: parent.id },
        root_post: { id: parent.id, username: "alice" },
        timestamp: threadsTime(clock),
      });
    scanImpl = async () => {
      throw visionFailure("not_food");
    };
    expect(await processMention(deps(), mk("u1", "bob"))).toEqual({
      status: "skipped",
      reason: "not_food",
    });
    scanImpl = async () => plate();
    expect((await processMention(deps(), mk("u2", "carol"))).status).toBe("pending_review");
  });
});

describe("daily caps", () => {
  test("per Threads user: the 4th photo of the day is skipped before the model (default 3)", async () => {
    const outcomes = [];
    for (let i = 0; i < 4; i++)
      outcomes.push(await processMention(deps(), imagePost({ username: "greedy" })));
    expect(outcomes.map((o) => o.status)).toEqual([
      "pending_review",
      "pending_review",
      "pending_review",
      "skipped",
    ]);
    expect(outcomes[3]).toEqual({ status: "skipped", reason: "user_cap" });
    expect(scans).toBe(3);
    expect(graph.imageFetches).toBe(3);
  });

  test("the user cap is per user and case-insensitive; tomorrow (WIB) is a new day", async () => {
    for (let i = 0; i < 3; i++)
      await processMention(deps(), imagePost({ username: i === 0 ? "Greedy" : "greedy" }));
    expect((await processMention(deps(), imagePost({ username: "other" }))).status).toBe(
      "pending_review",
    );
    expect(await processMention(deps(), imagePost({ username: "GREEDY" }))).toEqual({
      status: "skipped",
      reason: "user_cap",
    });
    clock = NOW + 24 * 3_600_000;
    expect(
      (
        await processMention(
          deps(),
          imagePost({ username: "greedy", timestamp: threadsTime(clock) }),
        )
      ).status,
    ).toBe("pending_review");
  });

  test("global: the cap counts scans over all users", async () => {
    const cfg = config({ THREADS_BOT_DAILY_CAP: "2" });
    const outcomes = [];
    for (let i = 0; i < 3; i++) outcomes.push(await processMention(deps(cfg), imagePost()));
    expect(outcomes[2]).toEqual({ status: "skipped", reason: "global_cap" });
    expect(scans).toBe(2);
  });

  test("a cap of 0 answers nobody", async () => {
    expect(
      await processMention(deps(config({ THREADS_BOT_USER_DAILY_CAP: "0" })), imagePost()),
    ).toEqual({ status: "skipped", reason: "user_cap" });
    expect(await processMention(deps(config({ THREADS_BOT_DAILY_CAP: "0" })), imagePost())).toEqual(
      { status: "skipped", reason: "global_cap" },
    );
    expect(scans).toBe(0);
  });

  test("a photo that reached the model costs a slot even when it was not food; a mention without image costs none", async () => {
    scanImpl = async () => {
      throw visionFailure("not_food");
    };
    for (let i = 0; i < 3; i++) await processMention(deps(), imagePost({ username: "snap" }));
    await processMention(
      deps(),
      imagePost({ username: "snap", media_type: "TEXT_POST", media_url: undefined }),
    );
    expect(await processMention(deps(), imagePost({ username: "snap" }))).toEqual({
      status: "skipped",
      reason: "user_cap",
    });
    expect(scans).toBe(3);
  });

  test("ten concurrent mentions from one user with a cap of 3 reach the model exactly 3 times", async () => {
    const posts = Array.from({ length: 10 }, () => imagePost({ username: "burst" }));
    const outcomes = await Promise.all(posts.map((post) => processMention(deps(), post)));
    expect(outcomes.filter((o) => o.status === "pending_review")).toHaveLength(3);
    expect(outcomes.filter((o) => o.status === "skipped")).toHaveLength(7);
    expect(scans).toBe(3);
  });

  test("twenty concurrent mentions from different users with a global cap of 5 reach the model exactly 5 times", async () => {
    const cfg = config({ THREADS_BOT_DAILY_CAP: "5" });
    const posts = Array.from({ length: 20 }, () => imagePost());
    await Promise.all(posts.map((post) => processMention(deps(cfg), post)));
    expect(scans).toBe(5);
  });
});

describe("scan outcomes", () => {
  test("not food: no reply is drafted, the mention is recorded as skipped", async () => {
    scanImpl = async () => {
      throw visionFailure("not_food");
    };
    const post = imagePost();
    expect(await processMention(deps(), post)).toEqual({ status: "skipped", reason: "not_food" });
    const row = await rowOf(post.id);
    expect(row.replyText).toBeNull();
    expect(row.status).toBe("skipped");
  });

  test("unclear and too_many get the short polite reply", async () => {
    for (const reason of ["unclear", "too_many"] as const) {
      scanImpl = async () => {
        throw visionFailure(reason);
      };
      const post = imagePost();
      expect(await processMention(deps(), post)).toEqual({
        status: "pending_review",
        kind: "unclear",
      });
      expect((await rowOf(post.id)).replyText).toBe(UNCLEAR_REPLY);
    }
  });

  test("low confidence gets the polite reply, never numbers", async () => {
    scanImpl = async () => analysis([{ name: "Entah apa", kcal: 300, confidence: 0.1 }]);
    const post = imagePost();
    expect(await processMention(deps(), post)).toEqual({
      status: "pending_review",
      kind: "unclear",
    });
    const row = await rowOf(post.id);
    expect(row.replyText).toBe(UNCLEAR_REPLY);
    expect(row.kcalLow).toBeNull();
  });

  test("a model timeout is recorded as failed and nothing is sent", async () => {
    scanImpl = async () => {
      throw visionFailure("timeout");
    };
    const post = imagePost();
    expect(await processMention(deps(config({ THREADS_BOT_MODE: "auto" })), post)).toEqual({
      status: "failed",
      error: "scan: timeout",
    });
    expect(graph.published).toHaveLength(0);
    expect((await rowOf(post.id)).status).toBe("failed");
  });

  test("the kcal band comes from config", async () => {
    const post = imagePost();
    await processMention(deps(config({ THREADS_BOT_KCAL_BAND: "0.1" })), post);
    const row = await rowOf(post.id);
    expect([row.kcalLow, row.kcalHigh]).toEqual([530, 650]);
    expect(row.replyText).toContain("(±10%)");
  });
});

describe("auto mode", () => {
  test("publishes the reply straight away under the mention (reply_to_id, then threads_publish)", async () => {
    const post = imagePost();
    const outcome = await processMention(deps(config({ THREADS_BOT_MODE: "auto" })), post);
    expect(outcome).toEqual({ status: "sent", replyId: "reply-1" });
    expect(graph.published).toHaveLength(1);
    expect(graph.published[0]!.replyTo).toBe(post.id);
    expect(graph.published[0]!.text).toContain("400–600 kcal");
    const row = await rowOf(post.id);
    expect(row.status).toBe("sent");
    expect(row.mode).toBe("auto");
    expect(row.replyMediaId).toBe("reply-1");
    expect(row.sentAt).not.toBeNull();
  });

  test("a failed publish lands in the review queue with the error, never lost", async () => {
    graph.failPublish = true;
    const post = imagePost();
    const outcome = await processMention(deps(config({ THREADS_BOT_MODE: "auto" })), post);
    expect(outcome.status).toBe("failed");
    const row = await rowOf(post.id);
    expect(row.status).toBe("pending_review");
    expect(row.error).toContain("publish failed");
    expect(row.replyText).toContain("kcal");
  });
});

describe("review queue: approve, edit, reject", () => {
  async function queued() {
    const post = imagePost();
    await processMention(deps(), post);
    return post;
  }

  test("approve posts the draft as a reply to the mention and logs it as sent", async () => {
    const post = await queued();
    const draft = (await rowOf(post.id)).replyText!;
    const outcome = await approveDraft(deps(), post.id, "admin@joyorogo.com");
    expect(outcome).toEqual({ status: "sent", replyId: "reply-1" });
    expect(graph.published).toEqual([{ replyTo: post.id, text: draft, creation: "container-1" }]);
    const create = graph
      .callsTo("/threads")
      .find((c) => c.method === "POST" && c.path.endsWith("/100/threads"))!;
    expect(create.params.get("media_type")).toBe("TEXT");
    expect(create.params.get("reply_to_id")).toBe(post.id);
    const row = await rowOf(post.id);
    expect(row).toMatchObject({
      status: "sent",
      replyMediaId: "reply-1",
      reviewedBy: "admin@joyorogo.com",
      mode: "review",
    });
    expect(row.sentAt).not.toBeNull();
  });

  test("approve with an edited text sends and stores the edit", async () => {
    const post = await queued();
    const outcome = await approveDraft(
      deps(),
      post.id,
      "admin@joyorogo.com",
      "Halo! Sekitar 500 kcal ya (perkiraan AI, bukan saran medis).",
    );
    expect(outcome).toEqual({ status: "sent", replyId: "reply-1" });
    expect(graph.published[0]!.text).toBe(
      "Halo! Sekitar 500 kcal ya (perkiraan AI, bukan saran medis).",
    );
    expect((await rowOf(post.id)).replyText).toBe(graph.published[0]!.text);
  });

  test("a second approve (double click, two admins) posts only once", async () => {
    const post = await queued();
    const results = await Promise.all([
      approveDraft(deps(), post.id, "a@x.id"),
      approveDraft(deps(), post.id, "b@x.id"),
    ]);
    expect(results.filter((r) => typeof r === "object" && r.status === "sent")).toHaveLength(1);
    expect(results.filter((r) => r === "not_pending")).toHaveLength(1);
    expect(graph.published).toHaveLength(1);
    expect(await approveDraft(deps(), post.id, "a@x.id")).toBe("not_pending");
  });

  test("a failed post returns the draft to the queue with the error; approving again can succeed", async () => {
    const post = await queued();
    graph.failPublish = true;
    const outcome = await approveDraft(deps(), post.id, "a@x.id");
    expect(outcome).toMatchObject({ status: "failed" });
    expect(await rowOf(post.id)).toMatchObject({ status: "pending_review" });
    expect((await rowOf(post.id)).error).toContain("publish failed");
    graph.failPublish = false;
    expect(await approveDraft(deps(), post.id, "a@x.id")).toEqual({
      status: "sent",
      replyId: "reply-1",
    });
    expect((await rowOf(post.id)).error).toBeNull();
  });

  test("edit saves the text without posting; reject drops the draft and cannot be approved after", async () => {
    const post = await queued();
    expect(await editDraft(db, post.id, "Teks baru", clock)).toBe(true);
    expect((await rowOf(post.id)).replyText).toBe("Teks baru");
    expect(graph.published).toHaveLength(0);
    expect(await rejectDraft(db, post.id, "a@x.id", clock)).toBe(true);
    expect(await rowOf(post.id)).toMatchObject({ status: "rejected", reviewedBy: "a@x.id" });
    expect(await approveDraft(deps(), post.id, "a@x.id")).toBe("not_pending");
    expect(await rejectDraft(db, post.id, "a@x.id", clock)).toBe(false);
    expect(await editDraft(db, post.id, "x", clock)).toBe(false);
    expect(graph.published).toHaveLength(0);
  });

  test("approve respects the kill switch and a missing token", async () => {
    const post = await queued();
    expect(await approveDraft(deps(config({ THREADS_BOT_MODE: "off" })), post.id, "a@x.id")).toBe(
      "off",
    );
    expect(graph.published).toHaveLength(0);
    await client.execute(`DELETE FROM threads_account`);
    expect(await approveDraft(deps(config({ THREADS_ACCESS_TOKEN: "" })), post.id, "a@x.id")).toBe(
      "no_token",
    );
  });

  test("a mention that was not queued cannot be approved", async () => {
    expect(await approveDraft(deps(), "nope", "a@x.id")).toBe("not_pending");
    const skipped = imagePost({ media_type: "TEXT_POST", media_url: undefined });
    await processMention(deps(), skipped);
    expect(await approveDraft(deps(), skipped.id, "a@x.id")).toBe("not_pending");
  });
});

describe("Graph failures", () => {
  test("an image fetch error frees the slot and the sweep finishes the mention later", async () => {
    graph.failImage = true;
    const post = imagePost({ username: "unlucky" });
    expect((await processMention(deps(), post)).status).toBe("retry");
    let row = await rowOf(post.id);
    expect(row).toMatchObject({ status: "received", attempts: 1, scannedAt: null });
    expect(scans).toBe(0);

    graph.failImage = false;
    expect(await sweepReceived(deps())).toBe(0);
    clock += 6 * 60_000;
    expect(await sweepReceived(deps())).toBe(1);
    row = await rowOf(post.id);
    expect(row.status).toBe("pending_review");
    expect(scans).toBe(1);
  });

  test("three failed tries give up", async () => {
    graph.failImage = true;
    const post = imagePost();
    await processMention(deps(), post);
    for (let i = 0; i < 2; i++) {
      clock += 6 * 60_000;
      await sweepReceived(deps());
    }
    expect((await rowOf(post.id)).status).toBe("failed");
    expect(scans).toBe(0);
  });

  test("an image URL on a host Threads does not serve from is never fetched", async () => {
    const post = imagePost({ media_url: "https://evil.example.com/x.jpg" });
    expect((await processMention(deps(), post)).status).toBe("retry");
    expect(graph.imageFetches).toBe(0);
  });

  test("a mention nobody could decide on within a day is expired", async () => {
    graph.failImage = true;
    const post = imagePost();
    await processMention(deps(), post);
    clock += 25 * 3_600_000;
    await sweepReceived(deps());
    expect(await rowOf(post.id)).toMatchObject({ status: "skipped", skipReason: "stale" });
  });

  test("without any token the mention waits as received and nothing is called", async () => {
    const post = imagePost();
    expect(await processMention(deps(config({ THREADS_ACCESS_TOKEN: "" })), post)).toEqual({
      status: "no_token",
    });
    expect((await rowOf(post.id)).status).toBe("received");
    expect(graph.calls).toHaveLength(0);
    expect(scans).toBe(0);
  });
});

describe("cron poll", () => {
  test("reads the mentions edge since the cursor, answers what is new, advances the cursor", async () => {
    const first = imagePost({ timestamp: threadsTime(clock, 120_000) });
    const second = imagePost({ timestamp: threadsTime(clock, 60_000) });
    graph.mentions = [second, first];
    const result = await pollMentions(deps());
    expect(result).toEqual({ polled: 2, handled: 2 });
    expect(scans).toBe(2);
    expect((await rowOf(first.id)).status).toBe("pending_review");

    const [account] = await db.select().from(threadsAccount);
    expect(account!.mentionsSince).toBe(Math.floor((clock - 60_000) / 1000));
    expect(account!.lastPolledAt).not.toBeNull();

    const polls = graph.callsTo("/mentions");
    expect(polls[0]!.params.get("since")).toBe(String(Math.floor(clock / 1000) - 3600));
    clock += 5 * 60_000;
    const again = await pollMentions(deps());
    expect(again.handled).toBe(0);
    expect(graph.callsTo("/mentions").at(-1)!.params.get("since")).toBe(
      String(Math.floor((NOW - 60_000) / 1000)),
    );
    expect(scans).toBe(2);
  });

  test("the webhook and the poll seeing one mention make one reply", async () => {
    const post = imagePost();
    graph.mentions = [post];
    await processMention(deps(), post);
    const result = await pollMentions(deps());
    expect(result.handled).toBe(0);
    expect(scans).toBe(1);
  });

  test("more mentions than one tick answers are recorded and finished by the sweep", async () => {
    const posts = Array.from({ length: 11 }, (_, i) =>
      imagePost({ username: `p${i}`, timestamp: threadsTime(clock, 600_000 - i * 1000) }),
    );
    graph.mentions = posts;
    expect((await pollMentions(deps())).handled).toBe(8);
    expect(await db.select().from(threadsMention)).toHaveLength(11);
    clock += 6 * 60_000;
    expect(await sweepReceived(deps())).toBe(3);
    expect(scans).toBe(11);
  });

  test("a failing edge records the error and answers nothing", async () => {
    graph.failMentions = true;
    expect(await pollMentions(deps())).toEqual({ polled: 0, handled: 0 });
    const [account] = await db.select().from(threadsAccount);
    expect(account!.lastError).toContain("poll:");
    expect(account!.mentionsSince).toBeNull();
  });
});
