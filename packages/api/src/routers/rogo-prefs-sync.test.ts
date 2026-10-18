import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { afterEach, describe, expect, setSystemTime, test, vi } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { DEFAULT_REMINDER_CONFIG, type ReminderConfig } from "../lib/reminder-config";
import type { RogoPrefKey } from "../lib/rogo-prefs";
import {
  createPrefsSync,
  emptyPrefsMeta,
  type PrefsBackend,
  type PrefsMeta,
  type PrefsSync,
} from "../lib/rogo-prefs-sync";
import type { PullAnswer } from "../lib/sync-engine";
import { syncRouter } from "./sync";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier, founder_until) VALUES
    ('p1', 'p1', 'p1@test.id', 'free', NULL),
    ('p2', 'p2', 'p2@test.id', 'free', NULL),
    ('p3', 'p3', 'p3@test.id', 'free', NULL),
    ('p4', 'p4', 'p4@test.id', 'free', NULL),
    ('p5', 'p5', 'p5@test.id', 'free', NULL),
    ('p6', 'p6', 'p6@test.id', 'free', NULL),
    ('p7', 'p7', 'p7@test.id', 'free', NULL),
    ('p8', 'p8', 'p8@test.id', 'free', NULL),
    ('p9', 'p9', 'p9@test.id', 'free', NULL),
    ('p10', 'p10', 'p10@test.id', 'free', NULL),
    ('p11', 'p11', 'p11@test.id', 'free', NULL),
    ('p12', 'p12', 'p12@test.id', 'free', NULL);
`);

const db = drizzle(client) as unknown as Database;
const as = (userId: string) => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context,
});

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);
const at = (seconds: number) => T0 + seconds * 1000;
const clock = (ms: number) => setSystemTime(new Date(ms));
afterEach(() => setSystemTime());

/** What the person's device holds for a key when it is not at its default. */
type Device = Map<string, unknown>;

/**
 * One phone: its clock, the sync store (survives an "app restart"), the device storage behind each key, and the
 * real sync router as the server.
 */
class Phone {
  meta: PrefsMeta = emptyPrefsMeta();
  readonly device: Device = new Map();
  readonly appliedBatches: RogoPrefKey[][] = [];
  user: string | null = null;
  sync!: PrefsSync;
  /** When set, pulls wait for it (a bad network). */
  stall: Promise<void> | null = null;
  pushes = 0;
  onPush: (() => void) | null = null;

  constructor(
    private readonly offsetMs = 0,
    private readonly debounceMs = 60_000,
  ) {
    this.start();
  }

  now = () => Date.now() + this.offsetMs;

  private backend(userId: string): PrefsBackend {
    // The dismissals are stored per account locally, like the apps do.
    const slot = (key: string) => (key.startsWith("dismissed.") ? `${key}@${userId}` : key);
    return {
      read: async (key) => this.device.get(slot(key)),
      write: async (key, value) => {
        if (value === undefined) this.device.delete(slot(key));
        else this.device.set(slot(key), value);
      },
      applied: (keys) => {
        this.appliedBatches.push(keys);
      },
    };
  }

  /** The app starting again: same stored sync state, fresh controller. */
  start(): void {
    this.sync = createPrefsSync({
      store: {
        read: async () => structuredClone(this.meta),
        write: async (meta) => {
          this.meta = structuredClone(meta);
        },
      },
      io: {
        now: this.now,
        pull: async (since): Promise<PullAnswer> => {
          await this.stall;
          return call(syncRouter.pull, { ns: "rogo", since }, as(this.user!));
        },
        push: async (clientNow, records) => {
          const answer = await call(
            syncRouter.push,
            { ns: "rogo", clientNow, records: records.map((r) => ({ ...r })) },
            as(this.user!),
          );
          this.pushes += 1;
          this.onPush?.();
          return answer;
        },
      },
      backend: (userId) => this.backend(userId),
      debounceMs: this.debounceMs,
    });
    this.sync.setUser(this.user);
  }

  signIn(userId: string): void {
    this.user = userId;
    this.sync.setUser(userId);
  }

  signOut(): void {
    this.sync.forget();
    this.user = null;
  }

  /** The person changes a setting: the setter writes the device, then notes it. */
  async edit(key: RogoPrefKey, value: unknown): Promise<void> {
    this.device.set(key, value);
    await this.sync.note(key, value);
  }

  /** The person puts a setting back to its default. */
  async reset(key: RogoPrefKey, defaultValue: unknown): Promise<void> {
    this.device.delete(key);
    await this.sync.note(key, defaultValue);
  }
}

async function rows(userId: string) {
  const result = await client.execute({
    sql: "SELECT kind, id, json, deleted_at FROM sync_record WHERE user_id = ? AND ns = 'rogo' ORDER BY id",
    args: [userId],
  });
  const raw: Record<string, unknown>[] = result.rows;
  return raw.map((r) => ({
    kind: String(r.kind),
    id: String(r.id),
    json: String(r.json),
    deleted: r.deleted_at !== null,
  }));
}

const REMINDERS: ReminderConfig = {
  ...DEFAULT_REMINDER_CONFIG,
  meals: {
    ...DEFAULT_REMINDER_CONFIG.meals,
    sarapan: { enabled: true, time: "06:45" },
  },
  water: { enabled: true, start: "07:00", end: "21:00", everyHours: 3 },
};

describe("two phones, one account", () => {
  test("a theme set on A reaches B", async () => {
    clock(at(0));
    const a = new Phone();
    const b = new Phone();
    a.signIn("p1");
    b.signIn("p1");
    await a.edit("theme", "dark");
    const sent = await a.sync.sync();
    expect(sent?.pushed).toBe(1);
    expect(await a.sync.pending()).toBe(0);
    clock(at(5));
    const got = await b.sync.sync();
    expect(got?.applied).toBe(1);
    expect(b.device.get("theme")).toBe("dark");
    expect(b.appliedBatches).toEqual([["theme"]]);
    expect(await b.sync.pending()).toBe(0);
  });

  test("an edit on B reaches A and nothing bounces back", async () => {
    clock(at(100));
    const a = new Phone();
    const b = new Phone();
    a.signIn("p2");
    b.signIn("p2");
    await a.edit("makan.view", "kalender");
    await a.sync.sync();
    clock(at(110));
    await b.sync.sync();
    clock(at(120));
    await b.edit("makan.view", "stiker");
    await b.sync.sync();
    clock(at(130));
    const second = await a.sync.sync();
    expect(second?.applied).toBe(1);
    expect(a.device.get("makan.view")).toBe("stiker");
    clock(at(140));
    const third = await a.sync.sync();
    expect(third?.pushed).toBe(0);
    expect(third?.applied).toBe(0);
  });

  test("a reset is a tombstone that puts the other phone back to its default", async () => {
    clock(at(200));
    const a = new Phone();
    const b = new Phone();
    a.signIn("p3");
    b.signIn("p3");
    await a.edit("theme", "dark");
    await a.sync.sync();
    clock(at(210));
    await b.sync.sync();
    expect(b.device.get("theme")).toBe("dark");

    clock(at(220));
    await a.reset("theme", "system");
    await a.sync.sync();
    expect(await rows("p3")).toEqual([{ kind: "pref", id: "theme", json: '{"value":null}', deleted: true }]);

    clock(at(230));
    await b.sync.sync();
    expect(b.device.has("theme")).toBe(false);
    expect(b.appliedBatches).toEqual([["theme"], ["theme"]]);
  });

  test("the reminder choices round trip as a complete config", async () => {
    clock(at(300));
    const a = new Phone();
    const b = new Phone();
    a.signIn("p4");
    b.signIn("p4");
    await a.edit("reminders", REMINDERS);
    await a.sync.sync();
    clock(at(310));
    await b.sync.sync();
    expect(b.device.get("reminders")).toEqual(REMINDERS);
    expect(b.appliedBatches).toEqual([["reminders"]]);

    // Putting every reminder back to the default is a tombstone too.
    clock(at(320));
    await b.reset("reminders", DEFAULT_REMINDER_CONFIG);
    await b.sync.sync();
    clock(at(330));
    await a.sync.sync();
    expect(a.device.has("reminders")).toBe(false);
  });

  test("concurrent edits: the later one wins on both phones", async () => {
    clock(at(400));
    const a = new Phone();
    const b = new Phone();
    a.signIn("p5");
    b.signIn("p5");
    await a.edit("theme", "dark");
    await a.sync.sync();
    clock(at(405));
    await b.sync.sync();

    clock(at(410));
    await a.edit("theme", "light");
    clock(at(420));
    await b.edit("makan.kind", "minuman");
    await b.reset("theme", "system");
    clock(at(430));
    await a.sync.sync();
    clock(at(440));
    await b.sync.sync();
    clock(at(450));
    await a.sync.sync();
    // B edited later, so system (a reset) won over A's light; the independent key merged both ways.
    expect(a.device.has("theme")).toBe(false);
    expect(b.device.has("theme")).toBe(false);
    expect(a.device.get("makan.kind")).toBe("minuman");
  });

  test("a phone with a wrong clock does not win by its clock alone", async () => {
    clock(at(500));
    const early = new Phone(60 * 60 * 1000);
    const late = new Phone();
    early.signIn("p6");
    late.signIn("p6");
    await early.edit("makan.view", "tempat");
    await early.sync.sync();
    clock(at(530));
    await late.sync.sync();
    clock(at(540));
    await late.edit("makan.view", "kalender");
    await late.sync.sync();
    clock(at(550));
    await early.sync.sync();
    expect(early.device.get("makan.view")).toBe("kalender");
  });

  test("first sign-in on a new phone restores the account's prefs and uploads nothing", async () => {
    clock(at(600));
    const old = new Phone();
    old.signIn("p7");
    await old.edit("theme", "dark");
    await old.edit("sticker", { hideNumbers: false, showName: true, watermark: true });
    await old.edit("dismissed.handlePrompt", true);
    await old.sync.sync();

    clock(at(610));
    const fresh = new Phone();
    fresh.signIn("p7");
    const report = await fresh.sync.restore("p7", 2000);
    expect(report?.applied).toBe(3);
    expect(report?.pushed).toBe(0);
    expect(fresh.device.get("theme")).toBe("dark");
    expect(fresh.device.get("sticker")).toEqual({ hideNumbers: false, showName: true, watermark: true });
    expect(fresh.device.get("dismissed.handlePrompt@p7")).toBe(true);
  });

  test("the first account on a phone adopts what the phone already had, an older edit that never beats the account", async () => {
    clock(at(700));
    const other = new Phone();
    other.signIn("p8");
    await other.edit("theme", "light");
    await other.sync.sync();

    clock(at(710));
    const phone = new Phone();
    phone.device.set("theme", "dark");
    phone.device.set("makan.view", "tempat");
    phone.signIn("p8");
    const report = await phone.sync.sync();
    // theme: the account's light wins over the device's dark; makan.view: the account had none, so it is uploaded.
    expect(phone.device.get("theme")).toBe("light");
    expect(phone.device.get("makan.view")).toBe("tempat");
    expect(report?.pushed).toBe(1);
    expect((await rows("p8")).map((r) => r.id)).toEqual(["makan.view", "theme"]);
  });
});

describe("accounts and sign-out", () => {
  test("another account never receives the previous account's prefs", async () => {
    clock(at(800));
    const phone = new Phone();
    phone.signIn("p9");
    await phone.edit("theme", "dark");
    await phone.sync.sync();

    phone.signOut();
    clock(at(810));
    // Changed while signed out: waits under the old account.
    await phone.edit("makan.view", "kalender");
    expect(await phone.sync.pending()).toBe(1);
    expect(await phone.sync.sync()).toBeNull();

    clock(at(820));
    phone.signIn("p10");
    const report = await phone.sync.sync();
    expect(report?.pushed).toBe(0);
    expect(await rows("p10")).toEqual([]);
    expect(await phone.sync.pending()).toBe(0);
    // The device settings stay as they are for keys the new account has no value for.
    expect(phone.device.get("theme")).toBe("dark");
    expect(phone.device.get("makan.view")).toBe("kalender");
    expect(phone.meta.userId).toBe("p10");
  });

  test("the new account's own prefs replace the device's and its edits sync", async () => {
    clock(at(900));
    const owner = new Phone();
    owner.signIn("p11");
    await owner.edit("theme", "light");
    await owner.sync.sync();

    clock(at(910));
    const phone = new Phone();
    phone.signIn("p12");
    await phone.edit("theme", "dark");
    await phone.sync.sync();
    phone.signOut();

    clock(at(920));
    phone.signIn("p11");
    await phone.sync.sync();
    expect(phone.device.get("theme")).toBe("light");
    clock(at(930));
    await phone.edit("makan.kind", "camilan");
    await phone.sync.sync();
    expect((await rows("p11")).map((r) => r.id)).toEqual(["makan.kind", "theme"]);
    // p12 still has only its own theme.
    expect((await rows("p12")).map((r) => r.id)).toEqual(["theme"]);
  });

  test("signing out keeps the device prefs and stops syncing; the same account resumes with its waiting edits", async () => {
    clock(at(1000));
    const phone = new Phone();
    phone.signIn("p1");
    await phone.edit("makan.kind", "minuman");
    await phone.sync.sync();
    phone.signOut();
    expect(phone.device.get("makan.kind")).toBe("minuman");

    clock(at(1010));
    await phone.edit("makan.kind", "camilan");
    expect(await phone.sync.sync()).toBeNull();

    clock(at(1020));
    phone.signIn("p1");
    const report = await phone.sync.sync();
    expect(report?.pushed).toBe(1);
    expect(JSON.parse((await rows("p1")).find((r) => r.id === "makan.kind")!.json)).toEqual({ value: "camilan" });
  });

  test("an app restart keeps the stored cursor and marks", async () => {
    clock(at(1100));
    const phone = new Phone();
    phone.signIn("p2");
    await phone.edit("theme", "dark");
    await phone.sync.sync();
    await phone.edit("makan.view", "tempat");
    phone.start();
    expect(await phone.sync.pending()).toBe(1);
    clock(at(1110));
    const report = await phone.sync.sync();
    expect(report?.pushed).toBe(1);
    expect(report?.applied).toBe(0);
  });
});

describe("what a phone accepts", () => {
  test("malformed values and unknown keys are never stored", async () => {
    clock(at(1200));
    const phone = new Phone();
    phone.signIn("p3");
    const push = (id: string, value: unknown) =>
      call(
        syncRouter.push,
        {
          ns: "rogo",
          clientNow: Date.now(),
          records: [{ kind: "pref", id, json: JSON.stringify({ value }), updatedAt: Date.now(), deletedAt: null, rank: 0 }],
        },
        as("p3"),
      );
    await push("theme", "purple");
    await push("sticker", { hideNumbers: "yes" });
    await push("reminders", [1, 2]);
    await push("makan.view", "kalender");
    await push("from-the-future", { a: 1 });

    clock(at(1210));
    const report = await phone.sync.sync();
    expect(report?.pulled).toBe(5);
    expect(report?.applied).toBe(1);
    expect([...phone.device.keys()]).toEqual(["makan.view"]);
    // Nothing the phone refused is sent back.
    expect(report?.pushed).toBe(0);
  });

  test("a local edit that is not a valid value is ignored", async () => {
    clock(at(1300));
    const phone = new Phone();
    phone.signIn("p4");
    await phone.sync.note("theme", "purple");
    await phone.sync.note("not-a-key", "x");
    await phone.sync.note("dismissed.handlePrompt", false);
    expect(await phone.sync.pending()).toBe(0);
  });
});

describe("triggers", () => {
  test("a local edit uploads itself after the quiet time", async () => {
    clock(at(1400));
    const phone = new Phone(0, 1);
    phone.signIn("p5");
    const uploaded = new Promise<void>((resolve) => {
      phone.onPush = resolve;
    });
    await phone.edit("theme", "dark");
    await uploaded;
    // A sync asked now queues behind the one the timer started, so it returns once that one is done.
    await phone.sync.sync();
    expect(await phone.sync.pending()).toBe(0);
    expect((await rows("p5")).some((r) => r.id === "theme")).toBe(true);
  });

  test("signing out cancels the pending upload", async () => {
    vi.useFakeTimers();
    try {
      clock(at(1450));
      const phone = new Phone(0, 2000);
      phone.signIn("p6");
      await phone.edit("theme", "dark");
      phone.signOut();
      vi.advanceTimersByTime(60_000);
      expect(phone.pushes).toBe(0);
      expect(await phone.sync.pending()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("restore gives up waiting after its time but the sync still finishes", async () => {
    clock(at(1500));
    const owner = new Phone();
    owner.signIn("p7");
    await owner.edit("makan.kind", "minuman");
    await owner.sync.sync();

    const phone = new Phone();
    let release!: () => void;
    phone.stall = new Promise<void>((resolve) => {
      release = resolve;
    });
    phone.signIn("p7");
    vi.useFakeTimers();
    try {
      const restored = phone.sync.restore("p7", 4000);
      vi.advanceTimersByTime(4000);
      expect(await restored).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    expect(phone.device.has("makan.kind")).toBe(false);

    // Real timers give the real clock back; the server's records live at the faked one.
    clock(at(1510));
    release();
    await phone.sync.sync();
    expect(phone.device.get("makan.kind")).toBe("minuman");
  });
});
