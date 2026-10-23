import { d1TestDb } from "@joyorogo/db/test-d1";
import { beforeEach, describe, expect, test } from "bun:test";


import { MAX_SCAN_RETRIES } from "./quota";
import { varPhotoKey } from "./sticker";
import type { StickersBucket } from "./sticker";
import { restoreVarVerdict, retryVarScan, varRetriesLeft } from "./varretry";

const USER = "user-1";
const OTHER = "user-2";

const { client, db } = await d1TestDb();

const PHOTO_BYTES = new Uint8Array([1, 2, 3, 4]).buffer;

/** Bucket tiruan: semua foto ada kecuali yang dihapus lewat `missing`. */
function fakeBucket(missing: Set<string> = new Set()): StickersBucket {
  return {
    async get(key) {
      if (missing.has(key)) return null;
      return {
        body: new ReadableStream(),
        size: PHOTO_BYTES.byteLength,
        arrayBuffer: async () => PHOTO_BYTES,
        httpMetadata: { contentType: "image/jpeg" },
      };
    },
    put: async () => undefined,
    delete: async () => undefined,
    list: async () => ({ objects: [], truncated: false }),
  };
}

type RunPayload = { messages?: Array<{ content?: Array<{ text?: string }> }> };

function isRunPayload(value: unknown): value is RunPayload {
  return typeof value === "object" && value !== null && "messages" in value;
}

/** AI tiruan: jawaban dari antrean, lalu menghitung panggilan dan prompt terakhir. */
function fakeAi(answers: string[]) {
  const queue = [...answers];
  const state = { calls: 0, lastPrompt: "" };
  return {
    state,
    run(_model: string, payload: unknown) {
      state.calls += 1;
      if (!isRunPayload(payload)) throw new Error("payload tanpa messages");
      state.lastPrompt = payload.messages?.[0]?.content?.[0]?.text ?? "";
      return Promise.resolve({ response: queue.shift() ?? "" });
    },
  };
}

const SAMA = `{"verdict":"sama","confidence":0.7,"reason":"mirip"}`;
const TURUN = `{"verdict":"turun","confidence":0.9,"reason":"lebih rata"}`;

async function scanRow(id: string) {
  const result = await client.execute({
    sql: "SELECT verdict, confidence, note, retries FROM var_scan WHERE id = ?",
    args: [id],
  });
  return result.rows[0] as unknown as {
    verdict: string;
    confidence: number | null;
    note: string | null;
    retries: number;
  };
}

beforeEach(async () => {
  await client.executeMultiple(
    `DELETE FROM var_scan; DELETE FROM ai_usage; DELETE FROM "user";
     INSERT INTO "user" (id, name, email) VALUES
       ('${USER}', 'A', 'a@test.id'), ('${OTHER}', 'B', 'b@test.id');
     INSERT INTO var_scan (id, user_id, date, photo_id, verdict, confidence, note, created_at) VALUES
       ('s1', '${USER}', '2026-10-01', 'p1', 'pertama', 1, 'baseline', 1000),
       ('s2', '${USER}', '2026-10-08', 'p2', 'naik', 0.5, 'catatan lama', 2000);`,
  );
});

describe("retryVarScan", () => {
  test("overwrites verdict, confidence and note on the same row; returns the old ones", async () => {
    const ai = fakeAi([TURUN]);
    const result = await retryVarScan(
      { db, bucket: fakeBucket(), ai },
      { userId: USER, id: "s2", hint: "pose sama", locale: "id" },
    );
    expect(result.scan).toEqual({ id: "s2", verdict: "turun", confidence: 0.9, note: "lebih rata" });
    expect(result.previous).toEqual({ verdict: "naik", confidence: 0.5, note: "catatan lama" });
    expect(result.retriesLeft).toBe(MAX_SCAN_RETRIES - 1);
    expect(await scanRow("s2")).toMatchObject({ verdict: "turun", confidence: 0.9, retries: 1 });
    expect(ai.state.lastPrompt).toContain("pose sama");
  });

  test("is free: the daily quota ledger only gets a retry row", async () => {
    await retryVarScan({ db, bucket: fakeBucket(), ai: fakeAi([SAMA]) }, { userId: USER, id: "s2", locale: "id" });
    const rows = await client.execute("SELECT scan_type FROM ai_usage");
    expect(rows.rows.map((r: Record<string, unknown>) => r.scan_type)).toEqual(["retry"]);
  });

  test("server-side cap: the third retry is rejected without calling the model", async () => {
    const ai = fakeAi([SAMA, TURUN, SAMA]);
    const deps = { db, bucket: fakeBucket(), ai };
    for (let i = 0; i < MAX_SCAN_RETRIES; i += 1) {
      await retryVarScan(deps, { userId: USER, id: "s2", locale: "id" });
    }
    expect(ai.state.calls).toBe(MAX_SCAN_RETRIES);
    await expect(retryVarScan(deps, { userId: USER, id: "s2", locale: "id" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      data: { retriesExhausted: true },
    });
    expect(ai.state.calls).toBe(MAX_SCAN_RETRIES);
    expect((await scanRow("s2")).retries).toBe(MAX_SCAN_RETRIES);
  });

  test("concurrent retries cannot slip past the cap", async () => {
    const ai = fakeAi([SAMA, SAMA, SAMA, SAMA, SAMA]);
    const deps = { db, bucket: fakeBucket(), ai };
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => retryVarScan(deps, { userId: USER, id: "s2", locale: "id" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(MAX_SCAN_RETRIES);
    expect((await scanRow("s2")).retries).toBe(MAX_SCAN_RETRIES);
  });

  test("a failed retry keeps the previous verdict and does not use up the cap", async () => {
    // Dua jawaban sampah = kedua usaha analisis gagal.
    const ai = fakeAi(["sampah", "sampah"]);
    await expect(
      retryVarScan({ db, bucket: fakeBucket(), ai }, { userId: USER, id: "s2", locale: "id" }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
    expect(await scanRow("s2")).toMatchObject({
      verdict: "naik",
      confidence: 0.5,
      note: "catatan lama",
      retries: 0,
    });
  });

  test("a missing stored photo fails cleanly and refunds the claim", async () => {
    const bucket = fakeBucket(new Set([varPhotoKey(USER, "p1")]));
    await expect(
      retryVarScan({ db, bucket, ai: fakeAi([SAMA]) }, { userId: USER, id: "s2", locale: "id" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await scanRow("s2")).retries).toBe(0);
  });

  test("the first scan has no comparison and cannot be retried", async () => {
    const ai = fakeAi([SAMA]);
    await expect(
      retryVarScan({ db, bucket: fakeBucket(), ai }, { userId: USER, id: "s1", locale: "id" }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
    expect(ai.state.calls).toBe(0);
  });

  test("another user's scan is not found", async () => {
    await expect(
      retryVarScan({ db, bucket: fakeBucket(), ai: fakeAi([SAMA]) }, { userId: OTHER, id: "s2", locale: "id" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("restoreVarVerdict", () => {
  test("puts the previous verdict back but keeps the retry spent", async () => {
    const { previous } = await retryVarScan(
      { db, bucket: fakeBucket(), ai: fakeAi([TURUN]) },
      { userId: USER, id: "s2", locale: "id" },
    );
    await restoreVarVerdict(db, USER, "s2", previous, "id");
    expect(await scanRow("s2")).toMatchObject({
      verdict: "naik",
      confidence: 0.5,
      note: "catatan lama",
      retries: 1,
    });
  });

  test("never touches someone else's row", async () => {
    await expect(
      restoreVarVerdict(db, OTHER, "s2", { verdict: "sama", confidence: 0.1, note: null }, "id"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await scanRow("s2")).verdict).toBe("naik");
  });
});

describe("varRetriesLeft", () => {
  test("counts down and never goes negative", () => {
    expect(varRetriesLeft(0)).toBe(MAX_SCAN_RETRIES);
    expect(varRetriesLeft(MAX_SCAN_RETRIES)).toBe(0);
    expect(varRetriesLeft(MAX_SCAN_RETRIES + 3)).toBe(0);
  });
});
