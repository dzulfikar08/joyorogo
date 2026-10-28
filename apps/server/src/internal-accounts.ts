import { sql } from "drizzle-orm";

/**
 * Logins that are ours, not users: the App Review account, the QA account and the landing demo account with its two fictional group mates
 * (packages/auth/scripts/{review,qa}-login.ts, scripts/demo-account.ts). They stay in the admin users list
 * for support, but never count in the overview, the signup series or broadcasts.
 * Exclude through this list; do not un-verify their emails.
 */
export const INTERNAL_EMAILS = [
  "review@joyorogo.com",
  "qa@joyorogo.com",
  "demo@joyorogo.com",
  "demo-dewi@joyorogo.com",
  "demo-bayu@joyorogo.com",
] as const;

/** `'a', 'b'` for use inside an SQL `in (...)`. */
export const internalEmailsSql = sql.join(
  INTERNAL_EMAILS.map((email) => sql`${email}`),
  sql`, `,
);
