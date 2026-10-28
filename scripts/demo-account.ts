#!/usr/bin/env bun
/**
 * Demo account for landing-page screenshots, in the production D1 database.
 *
 *   demo@joyorogo.com  "Rina" (@rina.demo), email/password login (REVIEW_LOGIN_EMAILS), public profile off
 *   demo-dewi@joyorogo.com, demo-bayu@joyorogo.com  fictional group mates, no credential (cannot sign in)
 *   group "Kantor Sehat" with the three of them
 *
 * Seeds the last 8 WIB days (today included, partial): 3-4 meals a day within the ~1.635 kcal target (one day under,
 * none over), sleep, water, a 31-day weigh-in trend 68.4 -> 67.6 kg and one short walk. Every row belongs to one of the
 * three fixed demo user ids; no other user's data is read or written. Re-running re-seeds the window (the demo users'
 * own logs are deleted and re-inserted, accounts and the group are upserted).
 *
 * The password is generated once and stored ONLY in ~/.config/joyorogo/demo-login.txt (mode 600); never printed.
 * `--rotate` makes a new one and signs the account out everywhere.
 *
 * Usage (repo root):
 *   bun scripts/demo-account.ts            dry run: SELECTs what exists, prints what would be written
 *   bun scripts/demo-account.ts --apply    writes, then logs row counts per table
 *   bun scripts/demo-account.ts --apply --rotate
 *
 * Plate photos are not seeded (there is no demo sticker asset to reuse). The email must be in REVIEW_LOGIN_EMAILS
 * (apps/server/wrangler.jsonc) and in INTERNAL_EMAILS (apps/server/src/internal-accounts.ts); both need a server deploy.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ACCOUNT_ID = "b7e6f8457bd39fa37a7eea5249799754";
const ROOT = resolve(import.meta.dir, "..");
// better-auth is a dependency of packages/auth only, not of the root.
const { hashPassword } = (await import(join(ROOT, "packages/auth/node_modules/better-auth/dist/crypto/index.mjs"))) as {
  hashPassword: (password: string) => Promise<string>;
};
const CREDENTIALS_FILE = join(homedir(), ".config", "joyorogo", "demo-login.txt");
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const ROTATE = argv.includes("--rotate");

const RINA = { id: "demo0000rina0000000000000000001", email: "demo@joyorogo.com", name: "Rina", handle: "rina.demo" };
const DEWI = { id: "demo0000dewi0000000000000000002", email: "demo-dewi@joyorogo.com", name: "Dewi", handle: "dewi.demo" };
const BAYU = { id: "demo0000bayu0000000000000000003", email: "demo-bayu@joyorogo.com", name: "Bayu", handle: "bayu.demo" };
const USERS = [RINA, DEWI, BAYU];
const TEAM_ID = "demo0000team000000000000000000001";
// Valid invite alphabet (A-Z without I/L/O, 2-9); the app shows the code to every member, so it is a plain one.
const INVITE_CODE = "SEHATKTR";
const TARGET_KCAL = 1635; // computeTargets(female 164 cm, born 1992, light, 62 kg by 2027-06-01) at 67.6 kg

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;

// --- dates (WIB) -------------------------------------------------------------
const WIB_MS = 7 * 3600_000;
const wibToday = new Date(Date.now() + WIB_MS).toISOString().slice(0, 10);
function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const atWib = (date: string, hh: number, mm: number): number => Date.parse(`${date}T00:00:00Z`) + (hh * 60 + mm) * 60_000 - WIB_MS;
const DAYS = Array.from({ length: 8 }, (_, i) => shift(wibToday, i - 7)); // oldest .. today
const FROM = DAYS[0]!;

const hash6 = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

// --- food --------------------------------------------------------------------
type Dish = [name: string, kcal: number, protein: number, carbs: number, fat: number, fiber: number, grams: number];
const D = {
  nasiUduk: ["Nasi uduk + telur dadar", 520, 16, 66, 21, 2, 260],
  buburAyam: ["Bubur ayam", 390, 16, 56, 11, 2, 300],
  rotiTelur: ["Roti gandum, telur rebus, pisang", 360, 15, 48, 12, 5, 220],
  lontongSayur: ["Lontong sayur", 430, 11, 63, 15, 5, 320],
  oatPisang: ["Oatmeal pisang", 330, 10, 56, 8, 7, 280],
  nasiKuning: ["Nasi kuning + ayam suwir", 480, 22, 62, 16, 2, 270],
  ayamBakar: ["Nasi, ayam bakar, lalapan", 610, 36, 70, 20, 4, 420],
  gado: ["Gado-gado + lontong", 530, 19, 58, 24, 9, 380],
  soto: ["Soto ayam + nasi", 480, 25, 56, 16, 3, 450],
  pecelLele: ["Nasi, pecel lele, sambal", 640, 31, 66, 28, 4, 400],
  tempeOrek: ["Nasi, tempe orek, sayur asem", 520, 19, 74, 15, 8, 430],
  pepesIkan: ["Nasi, pepes ikan, tumis kangkung", 560, 32, 66, 17, 5, 440],
  pecelSayur: ["Pecel sayur + tempe", 380, 16, 36, 20, 9, 330],
  supAyam: ["Sup ayam + nasi setengah", 420, 26, 46, 13, 4, 420],
  ikanBakar: ["Nasi, ikan bakar, tumis buncis", 520, 33, 58, 17, 5, 400],
  capcay: ["Capcay + tahu goreng", 340, 17, 24, 19, 6, 320],
  pisang: ["Pisang", 90, 1, 23, 0, 2, 100],
  tahuBacem: ["Tahu bacem", 120, 8, 9, 6, 1, 70],
  kacang: ["Kacang rebus", 110, 5, 12, 5, 3, 60],
  yoghurt: ["Yoghurt plain + buah", 130, 7, 16, 4, 1, 150],
  jeruk: ["Jeruk", 60, 1, 15, 0, 3, 130],
  pisangGoreng: ["Pisang goreng", 150, 1, 22, 7, 2, 70],
} satisfies Record<string, Dish>;
type K = keyof typeof D;
type Slot = "sarapan" | "makan_siang" | "makan_malam" | "snack";
const SLOT_TIME: Record<Slot, [number, number]> = { sarapan: [7, 30], makan_siang: [12, 30], makan_malam: [19, 0], snack: [15, 30] };
type DayPlan = Array<[Slot, K]>;

// Rina, oldest -> today (today is partial: it is still daytime).
const RINA_PLAN: DayPlan[] = [
  [["sarapan", "nasiKuning"], ["makan_siang", "tempeOrek"], ["makan_malam", "supAyam"], ["snack", "yoghurt"]],
  [["sarapan", "nasiUduk"], ["makan_siang", "soto"], ["makan_malam", "capcay"], ["snack", "pisangGoreng"], ["snack", "kacang"]],
  [["sarapan", "buburAyam"], ["makan_siang", "pepesIkan"], ["makan_malam", "supAyam"], ["snack", "yoghurt"], ["snack", "jeruk"]],
  [["sarapan", "oatPisang"], ["makan_siang", "gado"], ["makan_malam", "capcay"], ["snack", "tahuBacem"], ["snack", "pisang"]], // under
  [["sarapan", "lontongSayur"], ["makan_siang", "ayamBakar"], ["makan_malam", "ikanBakar"], ["snack", "jeruk"]],
  [["sarapan", "rotiTelur"], ["makan_siang", "pecelLele"], ["makan_malam", "pecelSayur"], ["snack", "tahuBacem"], ["snack", "pisang"]],
  [["sarapan", "nasiKuning"], ["makan_siang", "gado"], ["makan_malam", "supAyam"], ["snack", "yoghurt"], ["snack", "jeruk"]],
  [["sarapan", "oatPisang"], ["makan_siang", "soto"], ["snack", "pisang"]],
];
const DEWI_PLAN: DayPlan[] = DAYS.map((_, i) => [
  ["sarapan", (["buburAyam", "oatPisang", "nasiUduk", "rotiTelur"] as K[])[i % 4]!],
  ["makan_siang", (["soto", "gado", "tempeOrek", "pepesIkan"] as K[])[i % 4]!],
  ["makan_malam", (["supAyam", "capcay", "pecelSayur", "ikanBakar"] as K[])[i % 4]!],
]);
// Bayu skips day 4 (a broken streak next to Dewi's 8 days and Rina's).
const BAYU_PLAN: DayPlan[] = DAYS.map((_, i) =>
  i === 3
    ? []
    : [
        ["sarapan", (["nasiKuning", "lontongSayur", "buburAyam"] as K[])[i % 3]!],
        ["makan_siang", (["ayamBakar", "pecelLele", "nasiUduk"] as K[])[i % 3]!],
        ["makan_malam", (["ikanBakar", "supAyam", "gado"] as K[])[i % 3]!],
      ],
);

// Guard the brief: every complete Rina day within target, exactly one clearly under.
const dayKcal = RINA_PLAN.map((day) => day.reduce((s, [, k]) => s + D[k][1], 0));
dayKcal.forEach((kcal, i) => {
  if (kcal > TARGET_KCAL) throw new Error(`${DAYS[i]} is over target: ${kcal}`);
});
const under = dayKcal.slice(0, -1).filter((k) => k < TARGET_KCAL * 0.9);
if (under.length !== 1) throw new Error(`expected exactly one under day, got ${under.length}: ${dayKcal.join(",")}`);

// --- sleep, water, weight ----------------------------------------------------
const SLEEP = [7.4, 7.0, 7.8, 8.2, 7.2, 7.6, 7.5, 7.9];
const WATER = [7, 6, 8, 7, 6, 8, 7, 4]; // today still counting
// Gentle linear 68.4 -> 67.6 over 31 days, +-0.2 deterministic noise, endpoints exact, one decimal.
const WEIGHT_DATES = Array.from({ length: 31 }, (_, i) => shift(wibToday, i - 30));
const WEIGHTS = WEIGHT_DATES.map((date, i) => {
  if (i === 0) return 68.4;
  if (i === 30) return 67.6;
  const noise = (parseInt(hash6(`w${date}`).slice(0, 4), 16) / 0xffff - 0.5) * 0.4;
  return Math.round((68.4 - (0.8 * i) / 30 + noise) * 10) / 10;
});

// --- SQL ---------------------------------------------------------------------
const now = Date.now();
const ids = USERS.map((u) => q(u.id)).join(", ");
const STMT_ROWS = 15; // literal values, no bound parameters; rows per INSERT only keeps statements small

function insertRows(table: string, cols: string[], rows: string[], conflict = "OR REPLACE"): string[] {
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += STMT_ROWS) {
    out.push(`INSERT ${conflict} INTO ${table} (${cols.join(", ")}) VALUES\n${rows.slice(i, i + STMT_ROWS).join(",\n")};`);
  }
  return out;
}

function foodRows(user: { id: string }, plan: DayPlan[]): string[] {
  const rows: string[] = [];
  plan.forEach((day, di) => {
    const seen = new Map<Slot, number>();
    day.forEach(([slot, key], idx) => {
      const [name, kcal, p, c, f, fi, g] = D[key];
      const k = seen.get(slot) ?? 0;
      seen.set(slot, k + 1);
      const [hh, mm] = SLOT_TIME[slot];
      const at = atWib(DAYS[di]!, hh + k, mm + (idx % 3) * 4);
      rows.push(
        `(${q(`demo-f-${hash6(`${user.id}${DAYS[di]}${idx}`)}`)}, ${q(user.id)}, ${q(DAYS[di]!)}, ${q(slot)}, ${q(name)}, ${kcal}, ${p}, ${c}, ${f}, ${fi}, ${g}, 'manual', ${at}, ${at})`,
      );
    });
  });
  return rows;
}

function buildSql(passwordHash: string | null, resetSessions: boolean): string[] {
  const s: string[] = [];
  // users: refuse to touch an existing email that is not ours (guarded by SELECT below as well)
  for (const u of USERS) {
    s.push(
      `INSERT INTO user (id, name, email, email_verified, tier, created_at, updated_at) VALUES (${q(u.id)}, ${q(u.name)}, ${q(u.email)}, 1, ${u === RINA ? "'founder'" : "'free'"}, ${now - 40 * 86400_000}, ${now})
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, tier = excluded.tier, email_verified = 1, updated_at = ${now};`,
    );
  }
  if (passwordHash) {
    s.push(
      `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES ('demo0000acct000000000000000000001', ${q(RINA.id)}, 'credential', ${q(RINA.id)}, ${q(passwordHash)}, ${now}, ${now})
       ON CONFLICT(provider_id, account_id) DO UPDATE SET password = excluded.password, updated_at = ${now};`,
    );
  }
  if (resetSessions) s.push(`DELETE FROM session WHERE user_id = ${q(RINA.id)};`);

  const prof: Array<[(typeof USERS)[number], string, number, string, number, number, number, string]> = [
    [RINA, "female", 164, "light", 67.6, 62, 1992, "2027-06-01"],
    [DEWI, "female", 160, "light", 64.0, 60, 1990, "2027-06-01"],
    [BAYU, "male", 172, "moderate", 80.5, 74, 1988, "2027-06-01"],
  ];
  for (const [u, gender, h, act, w, tw, by, td] of prof) {
    s.push(
      `INSERT INTO profile (user_id, handle, public_profile, share_enabled, share_maps, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, timezone, locale, created_at, updated_at)
       VALUES (${q(u.id)}, ${q(u.handle)}, 0, 0, 0, ${by}, ${q(gender)}, ${h}, ${u === RINA ? 68.4 : w}, ${tw}, ${q(td)}, ${q(act)}, 'Asia/Jakarta', 'id', ${now - 40 * 86400_000}, ${now})
       ON CONFLICT(user_id) DO UPDATE SET handle = excluded.handle, public_profile = 0, share_enabled = 0, share_maps = 0, birth_year = excluded.birth_year,
         gender = excluded.gender, height_cm = excluded.height_cm, start_weight_kg = excluded.start_weight_kg, target_weight_kg = excluded.target_weight_kg,
         target_date = excluded.target_date, activity_level = excluded.activity_level, timezone = 'Asia/Jakarta', locale = 'id', updated_at = ${now};`,
    );
  }

  // The demo users' own logs are replaced wholesale (scoped to the three fixed ids).
  for (const t of ["food_log", "weight_log", "sleep_log", "water_log", "exercise_log"]) {
    s.push(`DELETE FROM ${t} WHERE user_id IN (${ids});`);
  }
  s.push(`DELETE FROM team_nudge WHERE team_id = ${q(TEAM_ID)};`);

  const foodCols = ["id", "user_id", "date", "meal", "name", "kcal", "protein", "carbs", "fat", "fiber", "grams", "source", "eaten_at", "created_at"];
  s.push(...insertRows("food_log", foodCols, [...foodRows(RINA, RINA_PLAN), ...foodRows(DEWI, DEWI_PLAN), ...foodRows(BAYU, BAYU_PLAN)]));

  s.push(
    ...insertRows(
      "weight_log",
      ["id", "user_id", "date", "weight_kg", "source", "created_at"],
      WEIGHT_DATES.map((d, i) => `(${q(`demo-w-${hash6(`${RINA.id}${d}`)}`)}, ${q(RINA.id)}, ${q(d)}, ${WEIGHTS[i]}, 'manual', ${atWib(d, 6, 40)})`),
    ),
  );
  s.push(
    ...insertRows(
      "sleep_log",
      ["id", "user_id", "date", "hours", "source", "created_at"],
      DAYS.map((d, i) => `(${q(`demo-s-${hash6(`${RINA.id}${d}`)}`)}, ${q(RINA.id)}, ${q(d)}, ${SLEEP[i]}, 'manual', ${atWib(d, 6, 50)})`),
    ),
  );
  s.push(...insertRows("water_log", ["user_id", "date", "glasses"], DAYS.map((d, i) => `(${q(RINA.id)}, ${q(d)}, ${WATER[i]})`)));
  const walkDay = DAYS[4]!;
  s.push(
    `INSERT OR REPLACE INTO exercise_log (id, user_id, date, type, name, duration_min, kcal, source, created_at) VALUES (${q(`demo-e-${hash6(walkDay)}`)}, ${q(RINA.id)}, ${q(walkDay)}, 'walk', 'Jalan santai', 35, 130, 'manual', ${atWib(walkDay, 17, 45)});`,
  );

  s.push(
    `INSERT INTO team (id, name, invite_code, owner_id, created_at) VALUES (${q(TEAM_ID)}, 'Kantor Sehat', ${q(INVITE_CODE)}, ${q(DEWI.id)}, ${now - 30 * 86400_000})
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, owner_id = excluded.owner_id;`,
  );
  for (const [u, role] of [[DEWI, "owner"], [RINA, "member"], [BAYU, "member"]] as const) {
    s.push(
      `INSERT INTO team_member (team_id, user_id, role, share_food, share_var, share_fitness, joined_at) VALUES (${q(TEAM_ID)}, ${q(u.id)}, ${q(role)}, 1, 0, 0, ${now - 28 * 86400_000})
       ON CONFLICT(team_id, user_id) DO UPDATE SET role = excluded.role, share_food = 1;`,
    );
  }
  s.push(
    `INSERT INTO team_nudge (id, team_id, from_user_id, to_user_id, kind, message, created_at, read_at) VALUES (${q(`demo-n-${hash6("poke")}`)}, ${q(TEAM_ID)}, ${q(DEWI.id)}, ${q(BAYU.id)}, 'poke', NULL, ${atWib(DAYS[5]!, 16, 0)}, ${atWib(DAYS[5]!, 16, 20)});`,
  );
  return s;
}

// --- wrangler ----------------------------------------------------------------
function wrangler(args: string[]): string {
  const proc = Bun.spawnSync(["bunx", "wrangler", "d1", "execute", "DB", "--remote", "--config", "apps/server/wrangler.jsonc", ...args], {
    cwd: ROOT,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString() || proc.stdout.toString());
  return proc.stdout.toString();
}
function select<T>(sql: string): T[] {
  const out = wrangler(["--json", "--command", sql]);
  return (JSON.parse(out.slice(out.indexOf("["))) as Array<{ results: T[] }>)[0]?.results ?? [];
}

const COUNTS = [
  ["user", `id IN (${ids})`],
  ["account", `user_id = ${q(RINA.id)}`],
  ["profile", `user_id IN (${ids})`],
  ["food_log", `user_id IN (${ids})`],
  ["weight_log", `user_id IN (${ids})`],
  ["sleep_log", `user_id IN (${ids})`],
  ["water_log", `user_id IN (${ids})`],
  ["exercise_log", `user_id IN (${ids})`],
  ["team", `id = ${q(TEAM_ID)}`],
  ["team_member", `team_id = ${q(TEAM_ID)}`],
  ["team_nudge", `team_id = ${q(TEAM_ID)}`],
] as const;
function counts(): Record<string, number> {
  // D1 caps compound SELECTs at a handful of terms, so one row of scalar subqueries instead of UNION ALL.
  const sql = `SELECT ${COUNTS.map(([t, w]) => `(SELECT count(*) FROM ${t} WHERE ${w}) AS ${t}`).join(", ")}`;
  return select<Record<string, number>>(sql)[0]!;
}

// Preflight: our emails / handle / invite code must be free or already ours.
const clashes = select<{ what: string; id: string }>(
  `SELECT 'email' AS what, id FROM user WHERE email IN (${USERS.map((u) => q(u.email)).join(", ")}) AND id NOT IN (${ids})
   UNION ALL SELECT 'handle', user_id FROM profile WHERE handle IN (${USERS.map((u) => q(u.handle)).join(", ")}) AND user_id NOT IN (${ids})
   UNION ALL SELECT 'invite_code', id FROM team WHERE invite_code = ${q(INVITE_CODE)} AND id <> ${q(TEAM_ID)}`,
);
if (clashes.length) throw new Error(`refusing to run, these belong to someone else: ${JSON.stringify(clashes)}`);

const before = counts();
console.log("existing demo rows:", JSON.stringify(before));

// --- password ----------------------------------------------------------------
function readStoredPassword(): string | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  return readFileSync(CREDENTIALS_FILE, "utf8").match(/^password: (\S+)$/m)?.[1] ?? null;
}
let password = ROTATE ? null : readStoredPassword();
const fresh = password === null;
if (APPLY && !password) {
  password = randomBytes(24).toString("base64url");
  mkdirSync(dirname(CREDENTIALS_FILE), { recursive: true, mode: 0o700 });
  writeFileSync(
    CREDENTIALS_FILE,
    ["JoyoRogo demo login (landing screenshots)", `email: ${RINA.email}`, `password: ${password}`, "", 'Sign in: JoyoRogo app > Masuk > "Masuk dengan email".', ""].join("\n"),
    { mode: 0o600 },
  );
  chmodSync(CREDENTIALS_FILE, 0o600);
}
const statements = buildSql(password ? await hashPassword(password) : "$HASH_PLACEHOLDER$", APPLY && (ROTATE || fresh));

const perTable: Record<string, number> = {};
for (const st of statements) {
  const t = st.match(/^(?:INSERT(?: OR REPLACE)? INTO|DELETE FROM) (\w+)/)?.[1] ?? "?";
  const rows = st.startsWith("DELETE") ? 0 : st.startsWith("INSERT") && st.includes("VALUES\n") ? st.split("\n").length - 1 : 1;
  perTable[t] = (perTable[t] ?? 0) + rows;
}
console.log(`window ${FROM}..${wibToday}; Rina kcal/day: ${dayKcal.join(", ")} (target ${TARGET_KCAL}); weights ${WEIGHTS[0]}..${WEIGHTS.at(-1)}`);
console.log("rows to write (upserts):", JSON.stringify(perTable), `${statements.length} statements`);
if (!APPLY) {
  console.log("dry run: nothing written. Re-run with --apply.");
  process.exit(0);
}

const sqlFile = join(tmpdir(), `demo-account-${process.pid}.sql`);
writeFileSync(sqlFile, statements.join("\n"), { mode: 0o600 });
try {
  wrangler(["--file", sqlFile]);
} finally {
  rmSync(sqlFile, { force: true });
}
console.log("demo rows now:", JSON.stringify(counts()));
console.log(`${RINA.email}: ready (${ROTATE ? "password rotated" : fresh ? "password created" : "stored password re-applied"}). Credentials: ${CREDENTIALS_FILE}`);
