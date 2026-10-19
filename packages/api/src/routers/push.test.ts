import { call } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { Context } from "../context";
import { flushOutbox } from "../lib/notify";
import { pushTestDb, seedDevice } from "../lib/push-test-db";
import { challengeRouter } from "./challenge";
import { groupRouter } from "./group";
import { pushRouter } from "./push";
import { socialRouter } from "./social";

// Registration and settings procedures, and the events of the social / group routers that reach the push pipeline.

const { client, db } = await pushTestDb();
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES
    ('own', 'Owner', 'own@test.id', 'free'),
    ('ann', 'Ann', 'ann@test.id', 'free'),
    ('bob', 'Bob', 'bob@test.id', 'free'),
    ('cat', 'Cat', 'cat@test.id', 'free');
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, handle)
    VALUES
    ('own', 1990, 'male', 170, 80, 72, '2030-01-01', 'light', 'owner'),
    ('ann', 1990, 'female', 160, 70, 62, '2030-01-01', 'light', 'ann_k'),
    ('bob', 1990, 'male', 175, 90, 80, '2030-01-01', 'light', 'bob_b'),
    ('cat', 1990, 'female', 165, 65, 60, '2030-01-01', 'light', 'cat_c');
  INSERT INTO post (id, user_id, kind, title, visibility) VALUES
    ('11111111-1111-1111-1111-111111111111', 'own', 'cerita', 'Halo', 'publik'),
    ('33333333-3333-3333-3333-333333333333', 'own', 'latihan', 'Lari malam', 'publik');
  UPDATE post SET stats_json = '{"source":"joyofit"}' WHERE id = '33333333-3333-3333-3333-333333333333';
  INSERT INTO team (id, name, owner_id, invite_code) VALUES ('t1', 'Tim Sehat', 'own', 'ABCD2345');
  INSERT INTO team_member (team_id, user_id, role) VALUES ('t1', 'own', 'owner'), ('t1', 'ann', 'member');
`);

const POST = "11111111-1111-1111-1111-111111111111";
const WATCH_POST = "33333333-3333-3333-3333-333333333333";

const waiting: Promise<unknown>[] = [];
const as = (userId: string, name = userId) => ({
  context: {
    db,
    env: {},
    locale: "id",
    waitUntil: (promise: Promise<unknown>) => waiting.push(promise),
    session: { user: { id: userId, name } },
  } as unknown as Context,
});
const settle = () => Promise.all(waiting.splice(0));

const realFetch = globalThis.fetch;
let expoBodies: { to: string; title: string; body: string; data: { kind: string; link: unknown; app: string } }[] = [];
beforeEach(() => {
  expoBodies = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const messages = JSON.parse(String(init?.body)) as typeof expoBodies;
    expoBodies.push(...messages);
    return Response.json({ data: messages.map((_, i) => ({ status: "ok", id: `T${i}` })) });
  }) as typeof fetch;
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  await client.executeMultiple(`DELETE FROM push_outbox; DELETE FROM push_device; DELETE FROM push_prefs; DELETE FROM social_follow;`);
});

const rejects = async (promise: Promise<unknown>, code: string) => {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as { code?: string } | null;
  expect(error?.code).toBe(code);
};

async function rows(sql: string) {
  return (await client.execute(sql)).rows;
}

describe("push.registerDevice / unregisterDevice", () => {
  const device = (token: string, app: "joyorogo" | "joyofit" = "joyorogo") => ({
    app,
    platform: "android" as const,
    expoToken: `ExponentPushToken[${token}]`,
    locale: "id",
  });

  test("registers a token, and the same token again only refreshes it", async () => {
    await call(pushRouter.registerDevice, device("a1"), as("own"));
    await call(pushRouter.registerDevice, device("a1"), as("own"));
    expect(await rows("SELECT user_id, app FROM push_device")).toHaveLength(1);
    const prefs = await call(pushRouter.prefs, undefined, as("own"));
    expect(prefs.devices).toEqual({ web: 0, joyorogo: 1, joyofit: 0 });
  });

  test("a token that moves to another account leaves the first", async () => {
    await call(pushRouter.registerDevice, device("a1"), as("own"));
    await call(pushRouter.registerDevice, device("a1"), as("ann"));
    const [row] = await rows("SELECT user_id FROM push_device");
    expect(row?.user_id).toBe("ann");
  });

  test("tells the two apps apart and keeps five phones per app", async () => {
    for (let i = 0; i < 5; i++) {
      await client.execute({
        sql: `INSERT INTO push_device (id, user_id, app, platform, expo_token, last_seen_at) VALUES (?, 'own', 'joyorogo', 'android', ?, ?)`,
        args: [`d${i}`, `ExponentPushToken[r${i}]`, 1_000 + i],
      });
    }
    await call(pushRouter.registerDevice, device("r5"), as("own"));
    await call(pushRouter.registerDevice, device("fit1", "joyofit"), as("own"));
    const prefs = await call(pushRouter.prefs, undefined, as("own"));
    expect(prefs.devices).toEqual({ web: 0, joyorogo: 5, joyofit: 1 });
    // the oldest one went, the new one stayed
    const tokens = (await rows("SELECT expo_token FROM push_device WHERE app = 'joyorogo'")).map((r) => String(r.expo_token));
    expect(tokens).toContain("ExponentPushToken[r5]");
    expect(tokens).not.toContain("ExponentPushToken[r0]");
  });

  test("rejects anything that is not an Expo token and only removes the caller's own token", async () => {
    await rejects(call(pushRouter.registerDevice, { ...device("x"), expoToken: "fcm-raw-token" }, as("own")), "BAD_REQUEST");
    await call(pushRouter.registerDevice, device("a1"), as("own"));
    await call(pushRouter.unregisterDevice, { expoToken: "ExponentPushToken[a1]" }, as("ann"));
    expect(await rows("SELECT 1 FROM push_device")).toHaveLength(1);
    await call(pushRouter.unregisterDevice, { expoToken: "ExponentPushToken[a1]" }, as("own"));
    expect(await rows("SELECT 1 FROM push_device")).toHaveLength(0);
  });

  test("web subscriptions are generalized out of fasting", async () => {
    const input = { endpoint: "https://push.example/1", keys: { p256dh: "k", auth: "a" } };
    await call(pushRouter.subscribeWeb, input, as("own"));
    await call(pushRouter.subscribeWeb, input, as("own"));
    expect((await call(pushRouter.prefs, undefined, as("own"))).devices.web).toBe(1);
    await call(pushRouter.unsubscribeWeb, { endpoint: input.endpoint }, as("ann"));
    expect((await call(pushRouter.prefs, undefined, as("own"))).devices.web).toBe(1);
    await call(pushRouter.unsubscribeWeb, { endpoint: input.endpoint }, as("own"));
    expect((await call(pushRouter.prefs, undefined, as("own"))).devices.web).toBe(0);
  });
});

describe("push.prefs / setPrefs", () => {
  test("defaults, then partial updates", async () => {
    const initial = await call(pushRouter.prefs, undefined, as("own"));
    expect(initial).toMatchObject({
      social: true,
      group: true,
      meal: true,
      weigh: true,
      recap: true,
      quiet: { enabled: true, start: "21:30", end: "06:30" },
    });
    const updated = await call(pushRouter.setPrefs, { social: false, quiet: { start: "22:00" } }, as("own"));
    expect(updated).toMatchObject({ social: false, group: true, quiet: { enabled: true, start: "22:00", end: "06:30" } });
    const again = await call(pushRouter.setPrefs, { quiet: { enabled: false } }, as("own"));
    expect(again).toMatchObject({ social: false, quiet: { enabled: false, start: "22:00" } });
  });

  test("rejects a malformed time", async () => {
    await rejects(call(pushRouter.setPrefs, { quiet: { start: "25:99" } }, as("own")), "BAD_REQUEST");
  });

  test("sendTest reports skipped without a device and sent with one", async () => {
    expect((await call(pushRouter.sendTest, undefined, as("own"))).status).toBe("skipped");
    await seedDevice(client, "own", "t1");
    const result = await call(pushRouter.sendTest, undefined, as("own"));
    expect(result).toEqual({ status: "sent", reached: true });
    expect(expoBodies[0]?.title).toBe("Notifikasi uji");
  });
});

describe("social events reach the pipeline", () => {
  test("a comment on a post pushes the author with a link to the thread; replies push whoever was answered", async () => {
    await seedDevice(client, "own", "own1");
    await seedDevice(client, "ann", "ann1");
    const first = await call(socialRouter.addComment, { postId: POST, body: "Mantap sekali" }, as("bob", "Bob"));
    await settle();
    expect(expoBodies).toHaveLength(1);
    expect(expoBodies[0]).toMatchObject({
      to: "ExponentPushToken[own1]",
      title: "Bob berkomentar",
      body: "Mantap sekali",
      data: { kind: "comment", link: { t: "post", postId: POST, commentId: first.id } },
    });

    await call(socialRouter.addComment, { postId: POST, body: "Setuju", parentId: first.id }, as("ann", "Ann"));
    await settle();
    // Ann replies to Bob's top-level comment: Bob has no phone, the post's author hears a comment
    expect(expoBodies.at(-1)).toMatchObject({ to: "ExponentPushToken[own1]", data: { kind: "comment" } });
  });

  test("a comment on a JoyoFit watch post goes to the author's JoyoFit phone", async () => {
    await seedDevice(client, "own", "rogo", "joyorogo");
    await seedDevice(client, "own", "fit", "joyofit");
    await call(socialRouter.addComment, { postId: WATCH_POST, body: "Kencang!" }, as("bob", "Bob"));
    await settle();
    expect(expoBodies.map((m) => m.to)).toEqual(["ExponentPushToken[fit]"]);
    expect(expoBodies[0]?.data.app).toBe("joyofit");
  });

  test("kudos push once per hour per person and post", async () => {
    await seedDevice(client, "own", "own1");
    await call(socialRouter.kudos, { postId: POST }, as("bob", "Bob"));
    await settle();
    await call(socialRouter.kudos, { postId: POST }, as("bob", "Bob")); // un-kudos
    await call(socialRouter.kudos, { postId: POST }, as("bob", "Bob")); // kudos again within the hour
    await settle();
    expect(expoBodies.filter((m) => m.data.kind === "kudos")).toHaveLength(1);
    expect(expoBodies[0]?.title).toBe("Bob kasih semangat");
  });

  test("a new follower is pushed once a day", async () => {
    await seedDevice(client, "own", "own1");
    await call(socialRouter.setFollow, { userId: "own", follow: true }, as("bob", "Bob"));
    await call(socialRouter.setFollow, { userId: "own", follow: false }, as("bob", "Bob"));
    await call(socialRouter.setFollow, { userId: "own", follow: true }, as("bob", "Bob"));
    await settle();
    const follows = expoBodies.filter((m) => m.data.kind === "follow");
    expect(follows).toHaveLength(1);
    expect(follows[0]?.data.link).toEqual({ t: "profile", handle: "bob_b" });
  });

  test("a new post notifies followers (not blocked ones) through the outbox, once per author per six hours", async () => {
    await seedDevice(client, "bob", "bob1");
    await seedDevice(client, "cat", "cat1");
    await client.executeMultiple(`
      INSERT INTO social_follow (follower_id, following_id) VALUES ('bob', 'own'), ('cat', 'own');
      INSERT INTO social_block (blocker_id, blocked_id) VALUES ('cat', 'own');
    `);
    await call(socialRouter.createPost, { kind: "cerita", caption: "Sarapan sehat", visibility: "publik" }, as("own", "Owner"));
    await settle();
    expect(await rows("SELECT user_id FROM push_outbox")).toHaveLength(1);
    expect(expoBodies).toHaveLength(0);
    await flushOutbox({ db, env: {} });
    expect(expoBodies).toHaveLength(1);
    expect(expoBodies[0]).toMatchObject({
      to: "ExponentPushToken[bob1]",
      title: "Owner membagikan postingan baru",
      body: "Sarapan sehat",
      data: { kind: "post" },
    });

    // a second post an hour later does not push bob again
    await call(socialRouter.createPost, { kind: "cerita", caption: "Makan siang", visibility: "publik" }, as("own", "Owner"));
    await settle();
    expect(await rows("SELECT user_id FROM push_outbox")).toHaveLength(1);
    await client.execute(`DELETE FROM social_block`);
  });

  test("a follower with Sosial switched off is left out of the fan-out", async () => {
    await seedDevice(client, "bob", "bob1");
    await client.executeMultiple(`
      INSERT INTO social_follow (follower_id, following_id) VALUES ('bob', 'own');
      INSERT INTO push_prefs (user_id, social) VALUES ('bob', 0);
    `);
    await call(socialRouter.createPost, { kind: "cerita", caption: "Halo semua", visibility: "publik" }, as("own", "Owner"));
    await settle();
    expect(await rows("SELECT 1 FROM push_outbox")).toHaveLength(0);
  });
});

describe("group events reach the pipeline", () => {
  test("poke and note push the recipient and link to the inbox", async () => {
    await seedDevice(client, "ann", "ann1");
    await call(groupRouter.nudge, { groupId: "t1", toUserId: "ann", kind: "poke" }, as("own", "Owner"));
    await call(groupRouter.nudge, { groupId: "t1", toUserId: "ann", kind: "note", message: "Ayo olahraga" }, as("own", "Owner"));
    await settle();
    expect(expoBodies).toHaveLength(2);
    expect(expoBodies[0]).toMatchObject({
      title: "Owner mencolekmu",
      body: "Semangat catat kalorinya hari ini!",
      data: { kind: "poke", link: { t: "inbox" } },
    });
    expect(expoBodies[1]).toMatchObject({ title: "Catatan dari Owner", body: "Ayo olahraga" });
  });

  test("a new member pushes the group owner", async () => {
    await seedDevice(client, "own", "own1");
    await call(groupRouter.join, { code: "ABCD2345" }, as("bob", "Bob"));
    await settle();
    expect(expoBodies[0]).toMatchObject({
      title: "Bob bergabung ke Tim Sehat",
      data: { kind: "member_join", link: { t: "group", groupId: "t1" } },
    });
    await client.execute(`DELETE FROM team_member WHERE user_id = 'bob'`);
  });

  test("challenge: create stores a push for the other members; join tells the host", async () => {
    await seedDevice(client, "ann", "ann1");
    await client.execute(`UPDATE "user" SET tier = 'founder' WHERE id = 'own'`);
    await client.execute(
      `INSERT INTO weight_log (id, user_id, date, weight_kg) VALUES ('w-own', 'own', '2026-10-18', 80), ('w-ann', 'ann', '2026-10-18', 70)`,
    );
    const created = await call(
      challengeRouter.create,
      { groupId: "t1", goal: "calories", target: null, durationDays: 7 },
      as("own", "Owner"),
    );
    await settle();
    const stored = await rows(`SELECT user_id, kind FROM push_outbox WHERE kind = 'challenge_new'`);
    expect(stored.map((r) => r.user_id)).toEqual(["ann"]);
    await flushOutbox({ db, env: {} });
    expect(expoBodies[0]).toMatchObject({
      to: "ExponentPushToken[ann1]",
      title: "Tantangan baru di Tim Sehat",
      data: { kind: "challenge_new", link: { t: "challenge", groupId: "t1", challengeId: created.id } },
    });

    await seedDevice(client, "own", "own1");
    await call(challengeRouter.join, { challengeId: created.id }, as("ann", "Ann"));
    await settle();
    expect(expoBodies.at(-1)).toMatchObject({ to: "ExponentPushToken[own1]", title: "Ann ikut tantanganmu" });
  });
});
