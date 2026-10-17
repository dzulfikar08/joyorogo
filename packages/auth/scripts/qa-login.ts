#!/usr/bin/env bun
/**
 * Creates (or repairs) the internal QA login in the production D1 database:
 * a credential account for qa@joyorogo.com on the free tier. Separate from the
 * App Review account (review-login.ts), which reviewers use and we never touch.
 *
 * - Sign-in goes through the REVIEW_LOGIN_EMAILS allowlist (sign-up stays off).
 * - email_verified = 0 keeps it out of broadcasts (they mail verified users only).
 * - admin.ts and broadcast.ts leave it out through internal-accounts.ts (with review@).
 *
 * The password is generated once and stored ONLY in ~/.config/joyorogo/qa-login.txt
 * (mode 600); this script never prints it. Re-running re-applies it (idempotent);
 * `--rotate` makes a new one and signs the account out everywhere.
 *
 * Usage (repo root):  bun packages/auth/scripts/qa-login.ts [--rotate]
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { hashPassword } from "better-auth/crypto";

const QA_EMAIL = "qa@joyorogo.com";
const QA_NAME = "JoyoRogo QA";
const CREDENTIALS_FILE = join(homedir(), ".config", "joyorogo", "qa-login.txt");
const ACCOUNT_ID = "3268f27664d77716b648b00c8850469e";
const ROOT = resolve(import.meta.dir, "../../..");

function readStoredPassword(): string | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  return readFileSync(CREDENTIALS_FILE, "utf8").match(/^password: (\S+)$/m)?.[1] ?? null;
}

function storePassword(password: string): void {
  mkdirSync(dirname(CREDENTIALS_FILE), { recursive: true, mode: 0o700 });
  writeFileSync(
    CREDENTIALS_FILE,
    [
      "JoyoRogo QA login (internal testing only; not the App Review account)",
      `email: ${QA_EMAIL}`,
      `password: ${password}`,
      "",
      "Sign in: web or app > Masuk > \"Masuk dengan email\".",
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
  password = randomBytes(24).toString("base64url");
  storePassword(password);
}

const hash = await hashPassword(password);
const now = Date.now();
const sql = [
  `INSERT INTO user (id, name, email, email_verified, tier, created_at, updated_at)
   VALUES ('${randomBytes(16).toString("hex")}', '${QA_NAME}', '${QA_EMAIL}', 0, 'free', ${now}, ${now})
   ON CONFLICT(email) DO UPDATE SET email_verified = 0, updated_at = ${now};`,
  `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
   SELECT '${randomBytes(16).toString("hex")}', id, 'credential', id, '${hash}', ${now}, ${now}
   FROM user WHERE email = '${QA_EMAIL}'
   ON CONFLICT(provider_id, account_id) DO UPDATE SET password = excluded.password, updated_at = ${now};`,
  ...(rotate || fresh
    ? [`DELETE FROM session WHERE user_id = (SELECT id FROM user WHERE email = '${QA_EMAIL}');`]
    : []),
].join("\n");

const sqlFile = join(tmpdir(), `qa-login-${process.pid}.sql`);
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
  `${QA_EMAIL}: account ready (${rotate ? "password rotated" : fresh ? "password created" : "stored password re-applied"}). Credentials: ${CREDENTIALS_FILE}`,
);
