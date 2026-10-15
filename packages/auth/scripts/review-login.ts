#!/usr/bin/env bun
/**
 * Creates (or repairs) the Google Play / App Store review account in the
 * production D1 database: a credential account for REVIEW_EMAIL with a
 * comped Founder tier (user.tier = 'founder', never expires), so the
 * reviewer can open every Premium screen.
 *
 * The password is generated once and stored ONLY in
 * ~/.config/joyorogo/review-login.txt (mode 600); this script never prints
 * it. Re-running re-applies the stored password and tier (idempotent).
 * `--rotate` generates a new password and signs the account out everywhere.
 *
 * Usage (repo root):  bun packages/auth/scripts/review-login.ts [--rotate]
 * The email must also be listed in REVIEW_LOGIN_EMAILS (wrangler.jsonc vars),
 * otherwise the server rejects the sign-in.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { hashPassword } from "better-auth/crypto";

const REVIEW_EMAIL = "review@joyorogo.com";
const REVIEW_NAME = "Google Play Reviewer";
const CREDENTIALS_FILE = join(homedir(), ".config", "joyorogo", "review-login.txt");
const ACCOUNT_ID = "b7e6f8457bd39fa37a7eea5249799754";
const ROOT = resolve(import.meta.dir, "../../..");

function readStoredPassword(): string | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  const match = readFileSync(CREDENTIALS_FILE, "utf8").match(/^password: (\S+)$/m);
  return match?.[1] ?? null;
}

function storePassword(password: string): void {
  mkdirSync(dirname(CREDENTIALS_FILE), { recursive: true, mode: 0o700 });
  writeFileSync(
    CREDENTIALS_FILE,
    [
      "JoyoRogo review login (Google Play / App Store reviewers)",
      `email: ${REVIEW_EMAIL}`,
      `password: ${password}`,
      "",
      "Sign in: JoyoRogo app > Masuk > \"Masuk dengan email\". Founder access is comped.",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  chmodSync(CREDENTIALS_FILE, 0o600);
}

const rotate = process.argv.includes("--rotate");
let password = rotate ? null : readStoredPassword();
const fresh = password === null;
if (!password) {
  // 24 random bytes = 192 bits, base64url (no characters that need quoting).
  password = randomBytes(24).toString("base64url");
  storePassword(password);
}

const hash = await hashPassword(password);
const now = Date.now();
const email = REVIEW_EMAIL;
const sql = [
  `INSERT INTO user (id, name, email, email_verified, tier, created_at, updated_at)
   VALUES ('${randomBytes(16).toString("hex")}', '${REVIEW_NAME}', '${email}', 1, 'founder', ${now}, ${now})
   ON CONFLICT(email) DO UPDATE SET tier = 'founder', email_verified = 1, updated_at = ${now};`,
  `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
   SELECT '${randomBytes(16).toString("hex")}', id, 'credential', id, '${hash}', ${now}, ${now}
   FROM user WHERE email = '${email}'
   ON CONFLICT(provider_id, account_id) DO UPDATE SET password = excluded.password, updated_at = ${now};`,
  ...(rotate || fresh
    ? [`DELETE FROM session WHERE user_id = (SELECT id FROM user WHERE email = '${email}');`]
    : []),
].join("\n");

const sqlFile = join(tmpdir(), `review-login-${process.pid}.sql`);
writeFileSync(sqlFile, sql, { mode: 0o600 });
try {
  const proc = Bun.spawnSync(
    ["bunx", "wrangler", "d1", "execute", "DB", "--remote", "--config", "apps/server/wrangler.jsonc", "--file", sqlFile],
    { cwd: ROOT, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID }, stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode !== 0) {
    console.error(proc.stderr.toString() || proc.stdout.toString());
    process.exit(1);
  }
} finally {
  rmSync(sqlFile, { force: true });
}
console.log(
  `${email}: account ready, Founder comped (${rotate ? "password rotated" : fresh ? "password created" : "stored password re-applied"}). Credentials: ${CREDENTIALS_FILE}`,
);
