import { sql } from "drizzle-orm";

/**
 * Logins that are ours, not users: the App Review account and the QA account
 * (packages/auth/scripts/{review,qa}-login.ts). They stay in the admin users list
 * for support, but never count in the overview, the signup series or broadcasts.
 * Exclude through this list; do not un-verify their emails.
 */
export const INTERNAL_EMAILS = ["review@joyorogo.com", "qa@joyorogo.com"] as const;

/** `'a', 'b'` for use inside an SQL `in (...)`. */
export const internalEmailsSql = sql.join(
  INTERNAL_EMAILS.map((email) => sql`${email}`),
  sql`, `,
);
