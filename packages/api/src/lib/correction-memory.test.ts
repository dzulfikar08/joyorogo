import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "../../../db/node_modules/@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

import type { Database } from "@joyorogo/db";
import { DEFAULT_DAY_ZONE } from "@joyorogo/i18n";
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
    expect(memory.offers[0]).toEqual({ ai: "es mambo susu", saved: "putih telur" });
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
    expect(memory.offers.map((o) => o.saved)).toEqual(["putih telur", "putih telur"]);
    expect(memory.pairs).toBe(0);
  });

  const offers = [
    { ai: "lontong", saved: "putih telur" },
    { ai: "es krim", saved: "putih telur" },
    { ai: "susu", saved: "putih telur" },
  ];

  test("chips: only when the top answer is the label the user corrected before", () => {
    expect(chipsFor([{ ai: "nasi uduk", saved: "nasi lemak" }], "nasi uduk")).toEqual(["nasi lemak"]);
    expect(chipsFor([{ ai: "nasi uduk", saved: "nasi lemak" }], "nasi lemak")).toEqual([]);
    expect(chipsFor([{ ai: "lontong", saved: "putih telur" }], "putih telur rebus")).toEqual([]);
    expect(chipsFor([], "nasi uduk")).toEqual([]);
  });

  test("chips: nasi putih gets no putih telur from lontong/es krim/susu corrections", () => {
    expect(chipsFor(offers, "nasi putih")).toEqual([]);
    expect(chipsFor(offers, "nasi goreng")).toEqual([]);
    expect(chipsFor(offers, "lontong")).toEqual(["putih telur"]);
  });

  test("chips: a generic shared word is no match, a distinctive one is", () => {
    expect(chipsFor([{ ai: "ayam goreng", saved: "tahu goreng" }], "nasi goreng")).toEqual([]);
    expect(chipsFor([{ ai: "nasi lemak", saved: "nasi konjac" }], "nasi lemak ayam")).toEqual(["nasi konjac"]);
  });

  test("konjac: nasi putih corrected to nasi konjac once is offered on the next nasi putih, and nasi to nasi konjac counts", () => {
    const pairs = tallyPairs([
      { ai: [item("nasi putih", 150)], saved: [item("nasi konjac", 150)] },
      { ai: [item("nasi", 150)], saved: [item("nasi konjac", 150)] },
    ]);
    expect(pairs.map((p) => p.ai).sort()).toEqual(["nasi", "nasi putih"]);
    const memory = buildMemory(pairs, []);
    expect(chipsFor(memory.offers, "nasi putih")).toEqual(["nasi konjac"]);
    expect(chipsFor(memory.offers, "nasi")).toEqual(["nasi konjac"]);
    expect(chipsFor(memory.offers, "nasi konjac")).toEqual([]);
    expect(chipsFor(memory.offers, "putih telur")).toEqual([]);
  });

  test("chips: a drink is offered drinks, a dish dishes", () => {
    expect(chipsFor([{ ai: "es kopi susu", saved: "putih telur" }], "es kopi susu")).toEqual([]);
    expect(chipsFor([{ ai: "es kopi susu", saved: "es teh manis" }], "es kopi susu")).toEqual(["es teh manis"]);
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
    const memory = await loadCorrectionMemory(db, "u1", DEFAULT_DAY_ZONE);
    expect(memory.pairs).toBe(1);
    expect(memory.offers[0]).toEqual({ ai: "es mambo susu", saved: "putih telur" });
    expect((await loadCorrectionMemory(db, "u2", DEFAULT_DAY_ZONE)).pairs).toBe(0);
  });
});
