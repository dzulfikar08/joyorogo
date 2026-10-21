import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "../../../db/node_modules/@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

import type { Database } from "@joyorogo/db";
import { aiUsage } from "@joyorogo/db/schema/fitness";

import { buildMemory, chipsFor, correctionMemoryEnabled, keptNames, loadCorrectionMemory, sessionPairs, tallyPairs } from "./correction-memory";
import type { CompactItem } from "./scan-outcome";

const item = (n: string, g: number, k = 100): CompactItem => ({ n, g, k });

describe("sessionPairs", () => {
  test("a rename whose weight also changed is one pair (susu 250 g -> putih telur 100 g)", () => {
    expect(sessionPairs([item("susu plastik", 250, 150)], [item("putih telur", 100, 52)])).toEqual([
      { ai: "susu plastik", saved: "putih telur" },
    ]);
  });

  test("an item the diary kept, a changed weight and an extra add are no pairs", () => {
    expect(sessionPairs([item("nasi", 150)], [item("nasi", 100)])).toEqual([]);
    expect(sessionPairs([item("nasi", 150)], [item("nasi", 150), item("telur", 50)])).toEqual([]);
  });

  test("two unmatched leftovers are ambiguous and give nothing", () => {
    expect(sessionPairs([item("a", 10), item("b", 400)], [item("c", 100), item("d", 900)])).toEqual([]);
  });

  test("the same food under a longer name is not a correction", () => {
    expect(sessionPairs([item("putih telur", 100)], [item("putih telur rebus", 40)])).toEqual([]);
  });
});

describe("memory", () => {
  const sessions = [
    { ai: [item("es mambo susu", 150)], saved: [item("putih telur", 100)] },
    { ai: [item("Es Mambo Susu", 100)], saved: [item("Putih telur", 100)] },
    { ai: [item("lontong", 150)], saved: [item("putih telur", 100)] },
  ];

  test("pairs seen twice make the block, a single sighting does not", () => {
    const pairs = tallyPairs(sessions);
    expect(pairs[0]).toEqual({ ai: "es mambo susu", saved: "putih telur", count: 2 });
    const memory = buildMemory(pairs, ["nasi putih", "tempe goreng"]);
    expect(memory.pairs).toBe(1);
    expect(memory.block).toContain('pengguna sudah 2x mengoreksi "es mambo susu" menjadi "putih telur"');
    expect(memory.block).toContain('hanya kalau kamu hendak menjawab "es mambo susu"');
    expect(memory.block).not.toContain("lontong");
    expect(memory.block).toContain("nasi putih, tempe goreng");
    expect(memory.block!.length).toBeLessThanOrEqual(760);
    expect(memory.learned).toEqual(["putih telur"]);
  });

  test("a food kept as the model said it, sharing a word with the target, is the named exception", () => {
    const kept = keptNames([
      { ai: [item("telur rebus", 50)], saved: [item("telur rebus", 50)] },
      { ai: [item("nasi", 150)], saved: [item("nasi", 100)] },
    ]);
    expect(kept).toEqual(["telur rebus", "nasi"]);
    const block = buildMemory(tallyPairs(sessions), [], kept).block!;
    expect(block).toContain('Kalau yang terlihat jelas "telur rebus", tulis itu');
    expect(block).not.toContain('"nasi", tulis itu');
  });

  test("no repeated pair, no block and no chips", () => {
    const memory = buildMemory(tallyPairs(sessions.slice(1)), ["nasi"]);
    expect(memory.block).toBeUndefined();
    expect(memory.learned).toEqual([]);
  });

  test("chips: only when the top answer is not already a learned food", () => {
    expect(chipsFor(["putih telur"], "nasi uduk")).toEqual(["putih telur"]);
    expect(chipsFor(["putih telur"], "putih telur rebus")).toEqual([]);
    expect(chipsFor([], "nasi uduk")).toEqual([]);
  });

  test("chips: a drink is offered drinks, a dish dishes (no putih telur under es kopi susu)", () => {
    expect(chipsFor(["putih telur"], "es kopi susu")).toEqual([]);
    expect(chipsFor(["putih telur", "es teh manis"], "es kopi susu")).toEqual(["es teh manis"]);
    expect(chipsFor(["putih telur", "es teh manis"], "nasi uduk")).toEqual(["putih telur"]);
  });

  test("allowlist", () => {
    expect(correctionMemoryEnabled({ CORRECTION_MEMORY_USER_IDS: "u1, u2" }, "u2")).toBe(true);
    expect(correctionMemoryEnabled({}, "u1")).toBe(false);
  });
});

describe("loadCorrectionMemory", () => {
  test("reads the user's saved scan sessions from the ledger, nobody else's", async () => {
    const client = createClient({ url: ":memory:" });
    const dir = join(import.meta.dir, "../../../db/src/migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await client.executeMultiple(readFileSync(join(dir, file), "utf8"));
    }
    const db = drizzle(client) as unknown as Database;
    await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('u1','a','a@t.id'),('u2','b','b@t.id');`);
    const put = (userId: string, ai: CompactItem[], saved: CompactItem[]) =>
      db.insert(aiUsage).values({
        id: crypto.randomUUID(),
        userId,
        model: "m",
        scanType: "user",
        latencyMs: 1,
        usageJson: JSON.stringify({ aiItems: ai, savedItems: saved }),
      });
    await put("u1", [item("es mambo susu", 150)], [item("putih telur", 100)]);
    await put("u1", [item("es mambo susu", 100)], [item("putih telur", 100)]);
    await put("u2", [item("tahu", 100)], [item("nasi", 200)]);
    const memory = await loadCorrectionMemory(db, "u1");
    expect(memory.pairs).toBe(1);
    expect(memory.learned).toEqual(["putih telur"]);
    expect((await loadCorrectionMemory(db, "u2")).pairs).toBe(0);
  });
});
