import { d1TestDb } from "@joyorogo/db/test-d1";
import { beforeEach, describe, expect, test } from "bun:test";

import { runKeluargaEmails } from "./email";
import type { EmailEnv } from "./email";

// Joyo Keluarga mails from the cron (docs/pricing/joyo-keluarga.md sections 2, 3): the owner's reminder before a
// rupiah-paid period ends, and the removal mail to a member the owner took out. Once each, and off with the flag.

const DAY = 86_400_000;
const { client, db } = await d1TestDb();

const sent: Array<{ to: unknown; subject: string; text: string }> = [];
const env = {
  EMAIL_FROM: "halo@mail.joyorogo.com",
  EMAIL: {
    send: async (message: { to: unknown; subject: string; text: string }) => {
      sent.push(message);
    },
  },
} as unknown as EmailEnv;

beforeEach(async () => {
  sent.length = 0;
  const now = Date.now();
  await client.executeMultiple(`
    DELETE FROM email_log; DELETE FROM household_event; DELETE FROM household_member; DELETE FROM household;
    DELETE FROM payment; DELETE FROM "user";
    INSERT INTO "user" (id, name, email) VALUES
      ('o1', 'Sari Wulan', 'o1@test.id'), ('o2', 'Budi', 'o2@test.id'), ('o3', 'Tono', 'o3@test.id'),
      ('m1', 'Ani', 'm1@test.id');
    INSERT INTO household (id, owner_id, paid_until) VALUES
      ('h1', 'o1', ${now + 2 * DAY}), ('h2', 'o2', ${now + 2 * DAY}), ('h3', 'o3', ${now + 20 * DAY});
    INSERT INTO payment (order_id, user_id, amount_idr, months, status, paid_at, product) VALUES
      ('JR2611180000-aaaa', 'o1', 58000, 1, 'paid', ${now - 28 * DAY}, 'keluarga'),
      ('google:GPA.1', 'o2', 58000, 1, 'paid', ${now - 28 * DAY}, 'keluarga'),
      ('JR2611180000-bbbb', 'o3', 58000, 1, 'paid', ${now - 10 * DAY}, 'keluarga');
    INSERT INTO household_event (id, household_id, user_id, kind, at) VALUES
      ('ev-removed', 'h1', 'm1', 'removed', ${now - DAY}),
      ('ev-old', 'h1', 'm1', 'removed', ${now - 5 * DAY}),
      ('ev-left', 'h1', 'm1', 'leave', ${now - DAY});
  `);
});

describe("runKeluargaEmails", () => {
  test("reminds the rupiah-paid owner and mails the removed member, once each", async () => {
    await runKeluargaEmails(env, db, true);
    const subjects = sent.map((m) => [m.to, m.subject]);
    expect(subjects).toContainEqual(["o1@test.id", expect.stringContaining("Joyo Keluarga")]);
    expect(subjects).toContainEqual(["m1@test.id", expect.stringContaining("Sari")]);
    // Play renews by itself (o2); a period 20 days out is not due (o3); an old removal and a leave send nothing.
    expect(sent).toHaveLength(2);
    expect(sent.find((m) => m.to === "m1@test.id")?.subject).not.toContain("Wulan");

    await runKeluargaEmails(env, db, true);
    expect(sent).toHaveLength(2);
  });

  test("sends nothing while KELUARGA_ENABLED is off", async () => {
    await runKeluargaEmails(env, db, false);
    expect(sent).toHaveLength(0);
  });
});
