import { describe, expect, test } from "bun:test";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { persistQueryClientRestore } from "@tanstack/react-query-persist-client";

import { cacheBusterKey } from "./cache-buster";

const PARTS = { build: "18c9295", wibToday: "2026-10-18", owner: "CVSNDwC3Fx2V5KuNtJ0jwzl29KhbkMjc" };
const SUMMARY_KEY = [["day", "summary"], { type: "query", input: { date: "2026-10-18" } }];
const DAY = 24 * 60 * 60 * 1000;

describe("cacheBusterKey", () => {
  test("the same build, day and account keep the saved cache", () => {
    expect(cacheBusterKey(PARTS)).toBe(cacheBusterKey({ ...PARTS }));
  });

  test("a new build, a new WIB day or another account drops it", () => {
    const key = cacheBusterKey(PARTS);
    expect(cacheBusterKey({ ...PARTS, build: "abc1234" })).not.toBe(key);
    expect(cacheBusterKey({ ...PARTS, wibToday: "2026-10-19" })).not.toBe(key);
    expect(cacheBusterKey({ ...PARTS, owner: "someone-else" })).not.toBe(key);
  });

  test("signed out is its own owner", () => {
    expect(cacheBusterKey({ ...PARTS, owner: null })).toContain(":anon");
  });
});

describe("a day.summary saved by an older build (18 Okt, before exerciseSources existed)", () => {
  // localStorage stand-in: what the owner's browser kept from the visit before the 20:30 deploy
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  const persister = createSyncStoragePersister({ storage, key: "jrg-cache", throttleTime: 0 });
  const oldSummary = { hasProfile: true, targets: { eatKcal: 1800 }, exerciseCredit: { enabled: true, activeKcal: 0 }, burnedKcal: 0 };

  async function restoreWith(build: string) {
    const client = new QueryClient();
    await persistQueryClientRestore({ queryClient: client, persister, maxAge: DAY, buster: cacheBusterKey({ ...PARTS, build }) });
    return client.getQueryData<typeof oldSummary>(SUMMARY_KEY);
  }

  test("is restored by the build that saved it", async () => {
    const writer = new QueryClient();
    writer.setQueryData(SUMMARY_KEY, oldSummary);
    const buster = cacheBusterKey({ ...PARTS, build: "a7bc5a9" });
    store.set("jrg-cache", JSON.stringify({ buster, timestamp: Date.now(), clientState: dehydrate(writer) }));
    expect(await restoreWith("a7bc5a9")).toEqual(oldSummary);
  });

  test("is not restored by the next build, which reads fields that summary does not have", async () => {
    expect(await restoreWith("18c9295")).toBeUndefined();
  });
});
