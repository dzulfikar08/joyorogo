import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { MAX_DISHWARE } from "../lib/dishware";
import { deleteAllUserData, deleteUserMedia } from "../lib/privacy";
import type { StickersBucket } from "../lib/sticker";
import { aiRouter } from "./ai";
import { dishwareRouter } from "./dishware";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email) VALUES ('own', 'Owner', 'own@t.id'), ('qa', 'QA', 'qa@t.id'), ('bob', 'Bob', 'bob@t.id'), ('eve', 'Eve', 'eve@t.id');
`);
const db = drizzle(client) as unknown as Database;

/** In-memory R2: only what dishware and the scan touch. */
function fakeBucket() {
  const objects = new Map<string, { bytes: ArrayBuffer; contentType?: string }>();
  const bucket = {
    put: (key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) => {
      objects.set(key, { bytes: value, contentType: options?.httpMetadata?.contentType });
      return Promise.resolve();
    },
    get: (key: string) => {
      const found = objects.get(key);
      return Promise.resolve(
        found
          ? {
              body: new ReadableStream(),
              size: found.bytes.byteLength,
              arrayBuffer: () => Promise.resolve(found.bytes),
              httpMetadata: { contentType: found.contentType },
              customMetadata: undefined,
            }
          : null,
      );
    },
    delete: (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
      return Promise.resolve();
    },
    list: ({ prefix }: { prefix: string }) =>
      Promise.resolve({ objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
  };
  return { bucket: bucket as unknown as StickersBucket, objects };
}

const DESCRIBE = JSON.stringify({ description: "putih polos, tepi bergelombang", card: false, plateToCardRatio: null });
const requests: Array<{ prompt: string }> = [];
/** Workers AI fake: answers with `text`, remembers the prompt it was sent. */
const fakeAi = (text: string) => ({
  run: (_model: string, body: unknown) => {
    const content = (body as { messages: Array<{ content: Array<{ type: string; text?: string }> }> }).messages[0]!.content;
    requests.push({ prompt: content.find((part) => part.type === "text")?.text ?? "" });
    return Promise.resolve({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 9 } });
  },
});

const store = fakeBucket();
const background: Promise<unknown>[] = [];
const ctx = (userId: string | null, text = DESCRIBE, allowlist = "own,qa") =>
  ({
    db,
    env: { AI: fakeAi(text), STICKERS: store.bucket, DISHWARE_USER_IDS: allowlist },
    locale: "id",
    waitUntil: (promise: Promise<unknown>) => background.push(promise),
    session: userId === null ? null : { user: { id: userId } },
    requestStartedAt: Date.now(),
  }) as unknown as Context;

const PHOTO = { imageBase64: "aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=", mimeType: "image/jpeg" as const };
const NEW = { ...PHOTO, name: "Piring makan putih", kind: "flat" as const, diameterCm: 24 };

const fails = (promise: Promise<unknown>) => promise.then(() => null, (error: { code?: string }) => error.code ?? "error");

describe("dishware router: who may call it", () => {
  test("a signed-out caller is UNAUTHORIZED on every procedure", async () => {
    for (const run of [
      () => call(dishwareRouter.status, undefined, { context: ctx(null) }),
      () => call(dishwareRouter.analyze, PHOTO, { context: ctx(null) }),
      () => call(dishwareRouter.create, NEW, { context: ctx(null) }),
      () => call(dishwareRouter.update, { id: "x", name: "y" }, { context: ctx(null) }),
      () => call(dishwareRouter.remove, { id: "x" }, { context: ctx(null) }),
    ]) {
      expect(await fails(run())).toBe("UNAUTHORIZED");
    }
  });

  test("a user outside the allowlist sees the feature as off and cannot use any of it", async () => {
    const status = await call(dishwareRouter.status, undefined, { context: ctx("bob") });
    expect(status).toMatchObject({ enabled: false, plates: [] });
    for (const run of [
      () => call(dishwareRouter.analyze, PHOTO, { context: ctx("bob") }),
      () => call(dishwareRouter.create, NEW, { context: ctx("bob") }),
      () => call(dishwareRouter.update, { id: "x", name: "y" }, { context: ctx("bob") }),
      () => call(dishwareRouter.remove, { id: "x" }, { context: ctx("bob") }),
    ]) {
      expect(await fails(run())).toBe("FORBIDDEN");
    }
    expect([...store.objects.keys()].filter((key) => key.includes("/bob/"))).toEqual([]);
  });

  test("an empty allowlist is nobody, not everybody", async () => {
    const status = await call(dishwareRouter.status, undefined, { context: ctx("own", DESCRIBE, "") });
    expect(status.enabled).toBe(false);
  });
});

describe("dishware router: registering", () => {
  test("create stores the photo privately under the owner's prefix and writes the description once", async () => {
    requests.length = 0;
    const made = await call(dishwareRouter.create, { ...NEW, name: ' Piring "putih" \n makan ' }, { context: ctx("own") });
    expect(made).toMatchObject({
      name: "Piring putih makan",
      kind: "flat",
      diameterCm: 24,
      widthCm: null,
      diameterSource: "manual",
      description: "putih polos, tepi bergelombang",
    });
    expect(made.photoUrl).toMatch(/^\/dishware-photo\/[a-f0-9]{32}$/);
    const key = `dishware/own/${made.photoUrl.split("/").pop()}.jpg`;
    expect(store.objects.get(key)?.contentType).toBe("image/jpeg");
    expect(requests).toHaveLength(1);
    const status = await call(dishwareRouter.status, undefined, { context: ctx("own") });
    expect(status).toMatchObject({ enabled: true, max: MAX_DISHWARE });
    expect(status.plates.map((p) => p.id)).toContain(made.id);
  });

  test("a description from analyze is reused: no second model call; the card estimate is kept as the source", async () => {
    requests.length = 0;
    const made = await call(
      dishwareRouter.create,
      { ...NEW, name: "Mangkuk", kind: "bowl", diameterCm: 14, diameterSource: "card", description: "biru, motif ayam jago" },
      { context: ctx("qa") },
    );
    expect(requests).toHaveLength(0);
    expect(made).toMatchObject({ description: "biru, motif ayam jago", diameterSource: "card" });
  });

  test("only a lunchbox keeps a width", async () => {
    const round = await call(dishwareRouter.create, { ...NEW, name: "Bulat", widthCm: 12, description: "x" }, { context: ctx("qa") });
    expect(round.widthCm).toBeNull();
    const box = await call(dishwareRouter.create, { ...NEW, name: "Kotak", kind: "lunchbox", diameterCm: 18, widthCm: 12, description: "x" }, { context: ctx("qa") });
    expect(box.widthCm).toBe(12);
  });

  test("an unbelievable size is rejected before anything is stored", async () => {
    const before = store.objects.size;
    expect(await fails(call(dishwareRouter.create, { ...NEW, diameterCm: 2 }, { context: ctx("own") }))).toBe("BAD_REQUEST");
    expect(await fails(call(dishwareRouter.create, { ...NEW, diameterCm: 120 }, { context: ctx("own") }))).toBe("BAD_REQUEST");
    expect(await fails(call(dishwareRouter.create, { ...NEW, name: "  \"\"  " }, { context: ctx("own") }))).toBe("BAD_REQUEST");
    expect(store.objects.size).toBe(before);
  });

  test("a model answer that is not JSON fails the registration and stores nothing", async () => {
    const before = store.objects.size;
    expect(await fails(call(dishwareRouter.create, NEW, { context: ctx("eve", "Piringnya cantik.", "eve") }))).toBe("INTERNAL_SERVER_ERROR");
    expect(store.objects.size).toBe(before);
    expect((await call(dishwareRouter.status, undefined, { context: ctx("eve", DESCRIBE, "eve") })).plates).toEqual([]);
  });

  test("at most MAX_DISHWARE plates per user", async () => {
    const all = (await call(dishwareRouter.status, undefined, { context: ctx("qa") })).plates.length;
    for (let i = all; i < MAX_DISHWARE; i++) {
      await call(dishwareRouter.create, { ...NEW, name: `Piring ${i}`, description: "x" }, { context: ctx("qa") });
    }
    expect(await fails(call(dishwareRouter.create, { ...NEW, description: "x" }, { context: ctx("qa") }))).toBe("CONFLICT");
  });

  test("analyze has its own small daily budget", async () => {
    const allow = "bob";
    let last: string | null = null;
    for (let i = 0; i < 13; i++) {
      last = await fails(call(dishwareRouter.analyze, PHOTO, { context: ctx("bob", DESCRIBE, allow) }));
      await Promise.all(background.splice(0));
    }
    expect(last).toBe("TOO_MANY_REQUESTS");
  });
});

describe("dishware router: other people's plates", () => {
  test("update and remove never touch another user's row: NOT_FOUND, and it is still there", async () => {
    const mine = await call(dishwareRouter.create, { ...NEW, name: "Punya own", description: "x" }, { context: ctx("own") });
    expect(await fails(call(dishwareRouter.update, { id: mine.id, name: "Dibajak" }, { context: ctx("qa") }))).toBe("NOT_FOUND");
    expect(await fails(call(dishwareRouter.remove, { id: mine.id }, { context: ctx("qa") }))).toBe("NOT_FOUND");
    const list = (await call(dishwareRouter.status, undefined, { context: ctx("own") })).plates;
    expect(list.find((p) => p.id === mine.id)?.name).toBe("Punya own");
    expect((await call(dishwareRouter.status, undefined, { context: ctx("qa") })).plates.map((p) => p.id)).not.toContain(mine.id);
  });

  test("update changes the size and a typed diameter replaces a card estimate", async () => {
    const made = await call(dishwareRouter.create, { ...NEW, name: "Dari kartu", diameterSource: "card", description: "x" }, { context: ctx("own") });
    const updated = await call(dishwareRouter.update, { id: made.id, diameterCm: 25.5, name: "Dari penggaris" }, { context: ctx("own") });
    expect(updated).toMatchObject({ name: "Dari penggaris", diameterCm: 25.5, diameterSource: "manual" });
  });

  test("remove deletes the row and the photo", async () => {
    const made = await call(dishwareRouter.create, { ...NEW, name: "Sementara", description: "x" }, { context: ctx("own") });
    const key = `dishware/own/${made.photoUrl.split("/").pop()}.jpg`;
    expect(store.objects.has(key)).toBe(true);
    await call(dishwareRouter.remove, { id: made.id }, { context: ctx("own") });
    expect(store.objects.has(key)).toBe(false);
    expect((await call(dishwareRouter.status, undefined, { context: ctx("own") })).plates.map((p) => p.id)).not.toContain(made.id);
  });

  test("an account wipe takes the rows and the photos with it", async () => {
    await call(dishwareRouter.create, { ...NEW, name: "Bob punya", description: "x" }, { context: ctx("bob", DESCRIBE, "bob") });
    expect([...store.objects.keys()].some((key) => key.startsWith("dishware/bob/"))).toBe(true);
    await deleteUserMedia(store.bucket, "bob", []);
    await deleteAllUserData(db, "bob");
    expect([...store.objects.keys()].some((key) => key.startsWith("dishware/bob/"))).toBe(false);
    expect((await call(dishwareRouter.status, undefined, { context: ctx("bob", DESCRIBE, "bob") })).plates).toEqual([]);
  });
});

describe("the photo scan with Piring saya", () => {
  const SCAN = PHOTO;
  const answer = (plate: string | null | undefined, card?: { seen: boolean; confidence: number }) =>
    JSON.stringify({
      ...(card === undefined ? {} : { card }),
      ...(plate === undefined ? {} : { plate }),
      items: [{ name: "nasi putih", kind: "makanan", kcal: 130, grams: 100, box: [100, 100, 600, 600] }],
    });

  test("a plate the model recognises is reported, and its size went into the prompt as text", async () => {
    const plates = (await call(dishwareRouter.status, undefined, { context: ctx("own") })).plates;
    requests.length = 0;
    const result = await call(aiRouter.analyzeFood, SCAN, { context: ctx("own", answer("P1")) });
    expect(requests[0]!.prompt).toContain(`P1: "${plates[0]!.name}"`);
    expect(requests[0]!.prompt).toContain("diameter 24 cm");
    expect(result.plate).toEqual({
      status: "matched",
      id: plates[0]!.id,
      name: plates[0]!.name,
      kind: "flat",
      diameterCm: 24,
      widthCm: null,
    });
    expect(result.items[0]!.name).toBe("nasi putih");
  });

  test("null, no field at all, and an invented label all end as 'not recognised', with the same items", async () => {
    const matched = await call(aiRouter.analyzeFood, SCAN, { context: ctx("own", answer("P1")) });
    for (const text of [answer(null), answer(undefined), answer("P9")]) {
      const result = await call(aiRouter.analyzeFood, SCAN, { context: ctx("own", text) });
      expect(result.plate).toEqual({ status: "none" });
      expect(result.items).toEqual(matched.items);
    }
  });

  test("the ledger keeps what was asked and answered, for measuring later", async () => {
    await Promise.all(background.splice(0));
    const rows = await client.execute(`select usage_json from ai_usage where user_id = 'own' and scan_type = 'user' order by created_at`);
    type Asked = { registered: number; matched: string | null; answer: string | null };
    const asked = (rows.rows as Array<Record<string, unknown>>).map(
      (row) => (JSON.parse(String(row.usage_json)) as { plate?: Asked }).plate,
    );
    expect(asked.every((p) => p !== undefined && p.registered >= 1)).toBe(true);
    expect(asked.some((p) => p?.matched !== null && p?.answer === "P1")).toBe(true);
    expect(asked.some((p) => p?.matched === null && p?.answer === "P9")).toBe(true);
  });

  test("a user outside the allowlist with plates on file is scanned exactly as before", async () => {
    await client.executeMultiple(
      `INSERT INTO dishware (id, user_id, name, kind, diameter_cm, photo_id, description) VALUES ('d-eve', 'eve', 'Piring Eve', 'flat', 22, 'ph1', 'merah')`,
    );
    requests.length = 0;
    const result = await call(aiRouter.analyzeFood, SCAN, { context: ctx("eve", answer("P1")) });
    expect(requests[0]!.prompt).not.toContain("Piring Eve");
    expect(requests[0]!.prompt).not.toContain('"plate"');
    expect(requests[0]!.prompt).not.toContain('"card"');
    expect("plate" in result).toBe(false);
    expect("card" in result).toBe(false);
  });

  test("an allowlisted user with no plates is asked about the card only, and gets no plate field", async () => {
    await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('new', 'New', 'new@t.id')`);
    requests.length = 0;
    const result = await call(aiRouter.analyzeFood, SCAN, { context: ctx("new", answer(undefined), "new") });
    expect(requests[0]!.prompt).toContain('"card"');
    expect(requests[0]!.prompt).not.toContain('"plate"');
    expect("plate" in result).toBe(false);
    expect("card" in result).toBe(false);
  });
});

describe("the photo scan with a card beside the food", () => {
  const answer = (card: { seen: boolean; confidence: number } | undefined, plate?: string | null) =>
    JSON.stringify({
      ...(card === undefined ? {} : { card }),
      ...(plate === undefined ? {} : { plate }),
      items: [{ name: "nasi putih", kind: "makanan", kcal: 130, grams: 100, box: [100, 100, 600, 600] }],
    });
  const ledgerOf = async (userId: string) => {
    await Promise.all(background.splice(0));
    const rows = await client.execute({
      sql: `select usage_json from ai_usage where user_id = ? and scan_type = 'user' order by created_at desc, rowid desc limit 1`,
      args: [userId],
    });
    const usage = JSON.parse(String((rows.rows as Array<Record<string, unknown>>)[0]!.usage_json)) as {
      card?: { seen: boolean; used: boolean; confidence: number };
      plate?: { registered: number; matched: string | null; answer: string | null };
    };
    // Only what the reference questions wrote; the row also holds timings, items and tokens.
    return { card: usage.card, ...(usage.plate ? { plate: usage.plate } : {}) };
  };

  test("a card the model is sure of is reported, and the card block went into the prompt as text", async () => {
    await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('kar', 'Kar', 'kar@t.id')`);
    requests.length = 0;
    const result = await call(aiRouter.analyzeFood, PHOTO, { context: ctx("kar", answer({ seen: true, confidence: 0.9 }), "kar") });
    expect(requests[0]!.prompt).toContain("Kartu pembanding");
    expect(requests[0]!.prompt).toContain("8,56 x 5,4 cm");
    expect(result.card).toEqual({ status: "used" });
    expect("plate" in result).toBe(false);
    expect(await ledgerOf("kar")).toEqual({ card: { seen: true, used: true, confidence: 0.9 } });
  });

  test("no card: no card line, the scan is the ordinary one, and the ledger says it was looked for", async () => {
    const seen = await call(aiRouter.analyzeFood, PHOTO, { context: ctx("kar", answer({ seen: true, confidence: 0.9 }), "kar") });
    const result = await call(aiRouter.analyzeFood, PHOTO, { context: ctx("kar", answer({ seen: false, confidence: 0 }), "kar") });
    expect("card" in result).toBe(false);
    expect(result.items).toEqual(seen.items);
    expect(await ledgerOf("kar")).toEqual({ card: { seen: false, used: false, confidence: 0 } });
  });

  test("a card the model is unsure of is logged as seen but not used, and not shown", async () => {
    const result = await call(aiRouter.analyzeFood, PHOTO, { context: ctx("kar", answer({ seen: true, confidence: 0.3 }), "kar") });
    expect("card" in result).toBe(false);
    expect(await ledgerOf("kar")).toEqual({ card: { seen: true, used: false, confidence: 0.3 } });
  });

  test("an answer without the card field is no card", async () => {
    const result = await call(aiRouter.analyzeFood, PHOTO, { context: ctx("kar", answer(undefined), "kar") });
    expect("card" in result).toBe(false);
    expect(await ledgerOf("kar")).toEqual({ card: { seen: false, used: false, confidence: 0 } });
  });

  test("with plates registered too: the card is reported, the plate is still matched, both are in the ledger", async () => {
    const plates = (await call(dishwareRouter.status, undefined, { context: ctx("own") })).plates;
    requests.length = 0;
    const result = await call(aiRouter.analyzeFood, PHOTO, { context: ctx("own", answer({ seen: true, confidence: 0.8 }, "P1")) });
    expect(requests[0]!.prompt).toContain("Kartu pembanding");
    expect(requests[0]!.prompt).toContain(`P1: "${plates[0]!.name}"`);
    expect(result.card).toEqual({ status: "used" });
    expect(result.plate).toMatchObject({ status: "matched", id: plates[0]!.id });
    const ledger = await ledgerOf("own");
    expect(ledger.card).toEqual({ seen: true, used: true, confidence: 0.8 });
    expect(ledger.plate).toMatchObject({ registered: plates.length, matched: plates[0]!.id, answer: "P1" });
  });

  test("with plates registered and no card: the plate is the fallback, then the ordinary scan", async () => {
    const withPlate = await call(aiRouter.analyzeFood, PHOTO, { context: ctx("own", answer({ seen: false, confidence: 0 }, "P1")) });
    expect("card" in withPlate).toBe(false);
    expect(withPlate.plate?.status).toBe("matched");
    const neither = await call(aiRouter.analyzeFood, PHOTO, { context: ctx("own", answer({ seen: false, confidence: 0 }, null)) });
    expect("card" in neither).toBe(false);
    expect(neither.plate).toEqual({ status: "none" });
    expect(neither.items).toEqual(withPlate.items);
  });

  test("Hitung ulang asks the same question and answers it the same way", async () => {
    const first = await call(aiRouter.analyzeFood, PHOTO, { context: ctx("kar", answer({ seen: false, confidence: 0 }), "kar") });
    expect(first.photoId).not.toBeNull();
    requests.length = 0;
    const retry = await call(aiRouter.analyzeFoodRetry, { photoId: first.photoId! }, { context: ctx("kar", answer({ seen: true, confidence: 0.95 }), "kar") });
    expect(requests[0]!.prompt).toContain("Kartu pembanding");
    expect(retry.card).toEqual({ status: "used" });
    await Promise.all(background.splice(0));
    const rows = await client.execute(`select usage_json from ai_usage where user_id = 'kar' and scan_type = 'retry'`);
    const usage = JSON.parse(String((rows.rows as Array<Record<string, unknown>>)[0]!.usage_json)) as { card?: unknown };
    expect(usage.card).toEqual({ seen: true, used: true, confidence: 0.95 });
  });
});
