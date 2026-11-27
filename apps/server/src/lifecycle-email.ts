import { and, eq, inArray, sql } from "drizzle-orm";

import { user } from "@joyorogo/db/schema/auth";
import { emailLog } from "@joyorogo/db/schema/billing";
import type { Database } from "@joyorogo/db";
import type { Locale } from "@joyorogo/i18n";
import { userLocale } from "@joyorogo/api/lib/messages";

import { deliver, renderFor } from "./broadcast";
import type { BroadcastDeps } from "./broadcast";
import type { Campaign } from "./broadcast-render";
import { claimEmail } from "./email";
import { INTERNAL_EMAILS } from "./internal-accounts";
import { listOptedOut } from "./unsubscribe";

/**
 * Lifecycle mail: nudges for people who signed up but never logged a meal, and
 * one win-back for people who stopped (docs/lifecycle-email.md).
 *
 * - "Activity" is a photo scan (ai_usage scan_type 'user') or any food_log row
 *   except Huawei imports; the latest of the two is the last active moment.
 * - `lifecycle_activate_1`: account 1-13 days old, never active. Ref = user id.
 * - `lifecycle_activate_2`: still never active, account at least 4 days old and
 *   `activate_1` sent at least 2 days ago. Ref = user id.
 * - `lifecycle_winback`: last active 14-45 days ago (meal push reminders stop at
 *   14 idle days), once per lapse (ref = "<userId>:<lastActiveMs>") and at most
 *   one per 30 days.
 * - `lifecycle_paid_1` / `lifecycle_paid_2`: check-ins in the first 14 days after
 *   someone's first real payment (not a test or Rp0 trial), while Pro is still on.
 *   `paid_1` from day 3 when they have been idle 3+ days (counting from the later
 *   of the payment and their last activity); `paid_2` from day 7, again 3+ idle
 *   days and nothing logged since `paid_1`, at least 3 days after it. Ref = user
 *   id, so once per person. A paying account in this window gets no activation mail.
 *   JoyoFit counts here (a fitness_score synced), so a Pro user who only uses the watch side is not "idle".
 *   Why: most October web buyers stopped logging in their first two weeks and let
 *   the month run out (docs/lifecycle-email.md).
 * - Promotional, so it goes out from the broadcast sender with the one-click
 *   unsubscribe, and broadcast opt-outs apply. Ours and ADMIN_EMAILS are skipped.
 * - Off unless LIFECYCLE_EMAIL=on. Sends only 09:00-19:59 WIB, at most
 *   SWEEP_LIMIT per tick, stopping at the first failed send.
 */

export const ACTIVATE_1_KIND = "lifecycle_activate_1" as const;
export const ACTIVATE_2_KIND = "lifecycle_activate_2" as const;
export const WINBACK_KIND = "lifecycle_winback" as const;
export const PAID_1_KIND = "lifecycle_paid_1" as const;
export const PAID_2_KIND = "lifecycle_paid_2" as const;
type LifecycleKind =
  | typeof ACTIVATE_1_KIND
  | typeof ACTIVATE_2_KIND
  | typeof WINBACK_KIND
  | typeof PAID_1_KIND
  | typeof PAID_2_KIND;

const DAY = 86_400_000;
/** Activation mails stop for accounts this old: older never-active accounts are a broadcast's job, not a drip's. */
const ACTIVATE_MAX_AGE_DAYS = 14;
const ACTIVATE_2_MIN_AGE_DAYS = 4;
const ACTIVATE_2_GAP_DAYS = 2;
export const WINBACK_MIN_IDLE_DAYS = 14;
const WINBACK_MAX_IDLE_DAYS = 45;
const WINBACK_COOLDOWN_DAYS = 30;
/** Paid check-ins run in the first two weeks after the first payment, when October's buyers dropped off. */
const PAID_WINDOW_DAYS = 14;
const PAID_1_MIN_DAYS = 3;
const PAID_2_MIN_DAYS = 7;
const PAID_IDLE_DAYS = 3;
const PAID_2_GAP_DAYS = 3;
const SWEEP_LIMIT = 20;
const SEND_FROM_HOUR_WIB = 9;
const SEND_UNTIL_HOUR_WIB = 20;

const APP_URL = "https://app.joyorogo.com/beranda";
const GROUP_URL = "https://app.joyorogo.com/grup";

const COPY: Record<LifecycleKind, Record<Locale, Campaign>> = {
  [ACTIVATE_1_KIND]: {
    id: {
      id: "lifecycle-activate-1",
      subject: "Foto makanan berikutnya, Joyo yang hitung",
      body: `Halo {nama},

Makasih sudah daftar di JoyoRogo! Cara paling cepat mulai: buka aplikasinya, foto makanan yang mau kamu makan, dan Joyo menghitung kalori, protein, karbo, dan lemaknya dalam beberapa detik.

Tidak perlu timbang atau cari di daftar makanan. Kalau angkanya meleset, tinggal koreksi pakai kata-kata, misalnya "nasinya setengah".

[Buka JoyoRogo](${APP_URL})

Salam,
Dzulfikar, JoyoRogo`,
    },
    en: {
      id: "lifecycle-activate-1",
      subject: "Snap your next meal, Joyo does the math",
      body: `Hi {nama},

Thanks for signing up for JoyoRogo! The quickest way to start: open the app, take a photo of what you are about to eat, and Joyo works out the calories, protein, carbs and fat in a few seconds.

No weighing, no searching food lists. If a number looks off, just correct it in words, like "half the rice".

[Open JoyoRogo](${APP_URL})

Best,
Dzulfikar, JoyoRogo`,
    },
    ms: {
      id: "lifecycle-activate-1",
      subject: "Ambil gambar makanan seterusnya, Joyo yang kira",
      body: `Hai {nama},

Terima kasih kerana mendaftar JoyoRogo! Cara paling cepat untuk mula: buka aplikasi, ambil gambar makanan yang anda mahu makan, dan Joyo mengira kalori, protein, karbohidrat dan lemaknya dalam beberapa saat.

Tidak perlu timbang atau cari dalam senarai makanan. Kalau angkanya tersasar, betulkan sahaja dengan kata-kata, contohnya "nasi separuh".

[Buka JoyoRogo](${APP_URL})

Salam,
Dzulfikar, JoyoRogo`,
    },
  },
  [ACTIVATE_2_KIND]: {
    id: {
      id: "lifecycle-activate-2",
      subject: "Satu foto saja dulu",
      body: `Halo {nama},

Belum sempat coba JoyoRogo? Tidak apa-apa. Mulai dari satu foto saja: makan siang atau camilan hari ini.

Dari situ kamu langsung lihat sisa kalori hari ini dan target protein yang dihitung dari berat badanmu sendiri. Scan foto gratis tiap hari.

[Coba sekarang](${APP_URL})

Salam,
Dzulfikar, JoyoRogo`,
    },
    en: {
      id: "lifecycle-activate-2",
      subject: "Just one photo to start",
      body: `Hi {nama},

Haven't had a chance to try JoyoRogo yet? No problem. Start with a single photo: today's lunch or a snack.

From there you see the calories you have left today and a protein target worked out from your own body weight. Photo scans are free every day.

[Try it now](${APP_URL})

Best,
Dzulfikar, JoyoRogo`,
    },
    ms: {
      id: "lifecycle-activate-2",
      subject: "Satu gambar sahaja dahulu",
      body: `Hai {nama},

Belum sempat mencuba JoyoRogo? Tidak mengapa. Mula dengan satu gambar sahaja: makan tengah hari atau snek hari ini.

Dari situ anda terus nampak baki kalori hari ini dan sasaran protein yang dikira daripada berat badan anda sendiri. Imbasan gambar percuma setiap hari.

[Cuba sekarang](${APP_URL})

Salam,
Dzulfikar, JoyoRogo`,
    },
  },
  [WINBACK_KIND]: {
    id: {
      id: "lifecycle-winback",
      subject: "Joyo kangen catatan makanmu",
      body: `Halo {nama},

Sudah beberapa minggu kamu tidak mencatat makan di JoyoRogo. Tidak perlu mulai dari awal atau mengejar yang terlewat: cukup foto makanan berikutnya dan lanjut dari hari ini.

Datamu masih aman di akunmu, termasuk riwayat makan dan berat badan.

[Lanjut catat](${APP_URL})

Kalau ada yang bikin kamu berhenti (fitur kurang, angka meleset, atau hal lain), balas email ini. Saya baca sendiri.

Salam,
Dzulfikar, JoyoRogo`,
    },
    en: {
      id: "lifecycle-winback",
      subject: "Joyo misses your meal log",
      body: `Hi {nama},

It has been a few weeks since you logged a meal in JoyoRogo. No need to start over or catch up on what you missed: just snap your next meal and carry on from today.

Your data is still safe in your account, including your meal and weight history.

[Pick up where you left off](${APP_URL})

If something made you stop (a missing feature, numbers that felt off, anything else), just reply to this email. I read every reply myself.

Best,
Dzulfikar, JoyoRogo`,
    },
    ms: {
      id: "lifecycle-winback",
      subject: "Joyo rindu catatan makan anda",
      body: `Hai {nama},

Sudah beberapa minggu anda tidak mencatat makanan di JoyoRogo. Tidak perlu mula semula atau mengejar yang tertinggal: ambil sahaja gambar makanan seterusnya dan teruskan dari hari ini.

Data anda masih selamat dalam akaun anda, termasuk sejarah makan dan berat badan.

[Teruskan mencatat](${APP_URL})

Kalau ada sesuatu yang membuat anda berhenti (ciri kurang, angka tersasar, atau perkara lain), balas sahaja e-mel ini. Saya baca sendiri.

Salam,
Dzulfikar, JoyoRogo`,
    },
  },
  [PAID_1_KIND]: {
    id: {
      id: "lifecycle-paid-1",
      subject: "Cara paling simpel mulai pakai Pro",
      body: `Halo {nama},

Makasih sudah berlangganan JoyoRogo Pro! Beberapa hari ini belum ada catatan makan baru, jadi coba dua cara paling simpel ini untuk mulai:

1. Foto makanan berikutnya. Kalau angkanya meleset, koreksi pakai kata-kata, misalnya "nasinya setengah".
2. Ajak satu teman ke grup. Diet bareng lebih awet: kalian bisa saling colek kalau ada yang lupa mencatat. [Buat grup](${GROUP_URL})

[Buka JoyoRogo](${APP_URL})

Ada yang bikin ribet, atau angkanya terasa meleset? Balas email ini. Saya baca sendiri.

Salam,
Dzulfikar, JoyoRogo`,
    },
    en: {
      id: "lifecycle-paid-1",
      subject: "The easiest way to use JoyoRogo Pro",
      body: `Hi {nama},

Thanks for subscribing to JoyoRogo Pro! Since there haven't been any meal logs for a few days, here are two easy ways to get started:

1. Snap your next meal. If a number looks off, correct it in words, like "half the rice".
2. Invite a friend to a group. It's easier to stick with it together: you can nudge each other when someone forgets to log. [Create a group](${GROUP_URL})

[Open JoyoRogo](${APP_URL})

Is something getting in the way, or do the numbers feel wrong? Just reply to this email. I read every reply myself.

Best,
Dzulfikar, JoyoRogo`,
    },
    ms: {
      id: "lifecycle-paid-1",
      subject: "Cara paling mudah menggunakan Pro anda",
      body: `Hai {nama},

Terima kasih kerana melanggan JoyoRogo Pro! Sudah beberapa hari tiada catatan makanan, jadi cuba dua cara paling mudah ini untuk mula:

1. Ambil gambar makanan seterusnya. Kalau angkanya tersasar, betulkan dengan kata-kata, contohnya "nasi separuh".
2. Ajak seorang kawan ke dalam kumpulan. Lebih mudah kekal konsisten kalau berdua: anda boleh saling mengingatkan kalau ada yang terlupa mencatat. [Buat kumpulan](${GROUP_URL})

[Buka JoyoRogo](${APP_URL})

Ada bahagian yang rumit, atau angkanya rasa tersasar? Balas sahaja e-mel ini. Saya baca sendiri.

Salam,
Dzulfikar, JoyoRogo`,
    },
  },
  [PAID_2_KIND]: {
    id: {
      id: "lifecycle-paid-2",
      subject: "Ada yang bisa saya bantu?",
      body: `Halo {nama},

Sudah seminggu kamu berlangganan Pro, dan beberapa hari terakhir belum ada catatan makan baru. Saya ingin tahu kalau ada yang bikin susah atau mengganjal, supaya bisa saya perbaiki.

Balas email ini satu baris saja, misalnya "lupa", "angkanya meleset", atau "fitur yang saya cari belum ada".

Kalau mau lanjut, cukup foto makanan berikutnya. Tidak perlu mengejar hari yang terlewat.

[Lanjut catat](${APP_URL})

Salam,
Dzulfikar, JoyoRogo`,
    },
    en: {
      id: "lifecycle-paid-2",
      subject: "Can I help with anything?",
      body: `Hi {nama},

It's been a week since you subscribed to Pro, and there haven't been any meal logs for the last few days. I'd like to know what's getting in the way, so I can fix it.

Just reply with one line, like "I keep forgetting", "the numbers are off" or "a feature I need is missing".

If you want to carry on, just snap your next meal. No need to catch up on the days you missed.

[Pick up where you left off](${APP_URL})

Best,
Dzulfikar, JoyoRogo`,
    },
    ms: {
      id: "lifecycle-paid-2",
      subject: "Ada apa-apa yang boleh saya bantu?",
      body: `Hai {nama},

Sudah seminggu anda melanggan Pro, dan beberapa hari kebelakangan ini tiada catatan makanan. Saya ingin tahu jika ada apa-apa yang menyukarkan, supaya dapat saya perbaiki.

Balas sahaja satu baris ringkas, contohnya "terlupa", "angkanya tersasar" atau "ciri yang saya perlukan belum ada".

Kalau mahu teruskan, ambil sahaja gambar makanan seterusnya. Tidak perlu mengejar hari yang tertinggal.

[Teruskan mencatat](${APP_URL})

Salam,
Dzulfikar, JoyoRogo`,
    },
  },
};

export type LifecycleConfig = {
  enabled: boolean;
  /** Lowercased: our own logins and the admins never get these. */
  skipEmails: string[];
};

type LifecycleEnv = { LIFECYCLE_EMAIL?: string; ADMIN_EMAILS?: string };

export function lifecycleConfig(env: LifecycleEnv): LifecycleConfig {
  return {
    enabled: env.LIFECYCLE_EMAIL?.trim().toLowerCase() === "on",
    skipEmails: [
      ...INTERNAL_EMAILS,
      ...(env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ],
  };
}

/** 09:00-19:59 in Jakarta: nobody gets a nudge at night. */
export function lifecycleSendHour(now: number): boolean {
  const hour = new Date(now + 7 * 3_600_000).getUTCHours();
  return hour >= SEND_FROM_HOUR_WIB && hour < SEND_UNTIL_HOUR_WIB;
}

export type LifecycleMail = {
  kind: LifecycleKind;
  ref: string;
  id: string;
  name: string;
  email: string;
};

/**
 * Who is due which mail right now, oldest due first. Pure reads; the sweep claims
 * each in email_log before sending. Skip list applied here (env-sized, D1 binds 100).
 */
export async function lifecycleDue(
  db: Database,
  config: LifecycleConfig,
  now: number,
): Promise<LifecycleMail[]> {
  // Spelled out: drizzle renders ${user.id} unqualified in a one-table select, which the subqueries would read as their own id.
  const lastActive = sql<number>`max(
    coalesce((select max(a.created_at) from ai_usage a where a.user_id = "user"."id" and a.scan_type = 'user'), 0),
    coalesce((select max(f.created_at) from food_log f where f.user_id = "user"."id" and f.source <> 'huawei'), 0)
  )`;
  // First real payment: not a test purchase, not a Rp0 trial, not a proration charge that grants no time.
  const firstPaid = sql<
    number | null
  >`(select min(p.paid_at) from payment p where p.user_id = "user"."id"
    and p.status = 'paid' and coalesce(p.is_test, 0) = 0 and p.amount_idr > 0 and p.months > 0)`;
  // JoyoFit use (a daily score synced from the watch). A JoyoFit-only account gets no meal drip, someone still syncing
  // is not lapsed, and a Pro user who opens JoyoFit every day is using what they paid for.
  const fitActive = sql<number>`coalesce((select max(s.updated_at) from fitness_score s where s.user_id = "user"."id"), 0)`;
  const people = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      founderUntil: user.founderUntil,
      lastActive,
      fitActive,
      firstPaid,
    })
    .from(user)
    .where(and(eq(user.emailVerified, true), sql`instr(${user.email}, '@') > 0`))
    .orderBy(user.createdAt);
  const sent = await db
    .select({ userId: emailLog.userId, kind: emailLog.kind, createdAt: emailLog.createdAt })
    .from(emailLog)
    .where(
      inArray(emailLog.kind, [
        ACTIVATE_1_KIND,
        ACTIVATE_2_KIND,
        WINBACK_KIND,
        PAID_1_KIND,
        PAID_2_KIND,
      ]),
    );
  const lastSent = new Map<string, number>();
  for (const row of sent) {
    const key = `${row.kind}:${row.userId}`;
    lastSent.set(key, Math.max(lastSent.get(key) ?? 0, row.createdAt.getTime()));
  }

  const due: LifecycleMail[] = [];
  for (const person of people) {
    if (config.skipEmails.includes(person.email.toLowerCase())) continue;
    const who = { id: person.id, name: person.name, email: person.email };
    const ageDays = (now - person.createdAt.getTime()) / DAY;
    const active = Number(person.lastActive) || 0;
    const paidAt = Number(person.firstPaid) || 0;
    const paidDays = (now - paidAt) / DAY;
    const stillPro = (person.founderUntil?.getTime() ?? 0) > now;
    if (paidAt > 0 && stillPro && paidDays < PAID_WINDOW_DAYS) {
      // Paying and in the first two weeks: the paid check-in replaces the activation drip.
      const used = Math.max(active, Number(person.fitActive) || 0);
      const idleDays = (now - Math.max(used, paidAt)) / DAY;
      if (paidDays < PAID_1_MIN_DAYS || idleDays < PAID_IDLE_DAYS) continue;
      const first = lastSent.get(`${PAID_1_KIND}:${person.id}`);
      if (first === undefined) {
        due.push({ ...who, kind: PAID_1_KIND, ref: person.id });
      } else if (
        paidDays >= PAID_2_MIN_DAYS &&
        used < first &&
        now - first >= PAID_2_GAP_DAYS * DAY &&
        !lastSent.has(`${PAID_2_KIND}:${person.id}`)
      ) {
        due.push({ ...who, kind: PAID_2_KIND, ref: person.id });
      }
      continue;
    }
    // JoyoFit users who never logged food signed up for the watch side: a "snap your meal" drip is not for them.
    const fit = Number(person.fitActive) || 0;
    if (active === 0) {
      if (fit > 0) continue;
      if (ageDays < 1 || ageDays >= ACTIVATE_MAX_AGE_DAYS) continue;
      const first = lastSent.get(`${ACTIVATE_1_KIND}:${person.id}`);
      if (first === undefined) {
        due.push({ ...who, kind: ACTIVATE_1_KIND, ref: person.id });
      } else if (
        ageDays >= ACTIVATE_2_MIN_AGE_DAYS &&
        now - first >= ACTIVATE_2_GAP_DAYS * DAY &&
        !lastSent.has(`${ACTIVATE_2_KIND}:${person.id}`)
      ) {
        due.push({ ...who, kind: ACTIVATE_2_KIND, ref: person.id });
      }
      continue;
    }
    // Still syncing JoyoFit: not lapsed, even with no meals logged.
    const idleDays = (now - Math.max(active, fit)) / DAY;
    if (idleDays < WINBACK_MIN_IDLE_DAYS || idleDays >= WINBACK_MAX_IDLE_DAYS) continue;
    const previous = lastSent.get(`${WINBACK_KIND}:${person.id}`);
    // A win-back sent after the last activity already covers this lapse; the cooldown spaces out repeat lapses.
    if (
      previous !== undefined &&
      (previous > active || now - previous < WINBACK_COOLDOWN_DAYS * DAY)
    )
      continue;
    due.push({ ...who, kind: WINBACK_KIND, ref: `${person.id}:${active}` });
  }
  return due;
}

export type LifecycleResult = { due: number; sent: number; failed: number; optedOut: number };

/**
 * Cron: mails up to `limit` people who are due. Never throws past the caller's
 * catch for a send failure: the claim is released so a later tick retries.
 */
export async function runLifecycleEmails(
  deps: BroadcastDeps,
  config: LifecycleConfig,
  now = Date.now(),
  limit = SWEEP_LIMIT,
): Promise<LifecycleResult> {
  const result: LifecycleResult = { due: 0, sent: 0, failed: 0, optedOut: 0 };
  if (!config.enabled || !deps.email || !lifecycleSendHour(now)) return result;
  const due = await lifecycleDue(deps.db, config, now);
  result.due = due.length;
  if (due.length === 0) return result;
  const optedOut = await listOptedOut(deps.bucket);
  let attempted = 0;
  for (const mail of due) {
    if (attempted >= limit) break;
    if (optedOut.has(mail.id)) {
      result.optedOut++;
      continue;
    }
    if (!(await claimEmail(deps.db, mail.id, mail.kind, mail.ref, new Date(now)))) continue;
    attempted++;
    const locale = await userLocale(deps.db, mail.id);
    const { mail: rendered, unsubscribeUrl } = await renderFor(
      deps,
      COPY[mail.kind][locale],
      mail,
      locale,
    );
    const sent = await deliver(deps, rendered, mail.email, unsubscribeUrl);
    if (sent.ok) {
      result.sent++;
      continue;
    }
    await deps.db
      .delete(emailLog)
      .where(and(eq(emailLog.kind, mail.kind), eq(emailLog.ref, mail.ref)));
    result.failed++;
    break;
  }
  return result;
}
