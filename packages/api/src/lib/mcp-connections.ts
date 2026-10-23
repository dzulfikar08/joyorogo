// The AI apps (Claude, ChatGPT, ...) a person connected to their account through the MCP connector
// (docs/mcp-connector.md): list them, revoke them, show what they read. The OAuth tables belong to Better Auth
// (packages/db/src/schema/oauth.ts); everything that changes them from our side is here.

import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import {
  mcpAudit,
  oauthAccessToken,
  oauthClient,
  oauthClientResource,
  oauthConsent,
  oauthRefreshToken,
} from "@joyorogo/db/schema/oauth";
import { isMcpDataScope } from "@joyorogo/auth/mcp-scopes";

import { D1_MAX_PARAMS, chunk } from "./d1";

/** Audit rows are kept this long. */
export const MCP_AUDIT_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ConnectionView {
  /** The OAuth client id; pass it to revoke. */
  clientId: string;
  /** The name the app gave itself when it registered ("Claude", "ChatGPT"); self-asserted, show the hosts next to it. */
  name: string;
  /** Hostnames of the callback URLs the app registered: where an authorization goes. */
  redirectHosts: string[];
  /** Data scopes the person agreed to (profile:read, food:read, ...). */
  scopes: string[];
  /** Epoch ms of the first consent. */
  connectedAt: number;
  /** Epoch ms of the last tool call this app made, null when it never called one. */
  lastUsedAt: number | null;
  /** Tool calls in the last 30 days. */
  calls30d: number;
}

export interface ActivityView {
  id: string;
  clientId: string;
  clientName: string | null;
  tool: string;
  /** JSON text of the arguments (dates and ids), cut to 500 characters. */
  args: string | null;
  /** ok, error, not_pro, rate_limited or scope. */
  outcome: string;
  ms: number;
  createdAt: number;
}

/** Better Auth stores string[] columns as JSON text. */
function parseList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function hostOf(uri: string): string | null {
  try {
    const url = new URL(uri);
    return url.host || url.protocol.replace(":", "");
  } catch {
    return null;
  }
}

export async function listConnections(db: Database, userId: string, now = Date.now()): Promise<ConnectionView[]> {
  const consents = await db
    .select({
      clientId: oauthConsent.clientId,
      scopes: oauthConsent.scopes,
      createdAt: oauthConsent.createdAt,
      name: oauthClient.name,
      redirectUris: oauthClient.redirectUris,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, userId))
    .orderBy(desc(oauthConsent.createdAt));
  if (consents.length === 0) return [];
  const usage = await db
    .select({
      clientId: mcpAudit.clientId,
      lastUsedAt: sql<number>`max(${mcpAudit.createdAt})`,
      calls: sql<number>`sum(case when ${mcpAudit.createdAt} >= ${now - 30 * DAY_MS} then 1 else 0 end)`,
    })
    .from(mcpAudit)
    .where(eq(mcpAudit.userId, userId))
    .groupBy(mcpAudit.clientId);
  const usageByClient = new Map(usage.map((row) => [row.clientId, row]));
  return consents.map((row) => ({
    clientId: row.clientId,
    name: row.name?.trim() || "MCP",
    redirectHosts: [...new Set(parseList(row.redirectUris).flatMap((uri) => hostOf(uri) ?? []))],
    scopes: parseList(row.scopes).filter(isMcpDataScope),
    connectedAt: row.createdAt?.getTime() ?? 0,
    lastUsedAt: usageByClient.get(row.clientId)?.lastUsedAt ?? null,
    calls30d: usageByClient.get(row.clientId)?.calls ?? 0,
  }));
}

/**
 * Cuts one app off from the account at once: its consent and every token it holds go. A JWT access token already in
 * the app's hands stops working on the next MCP request too, because the endpoint looks the consent up each time.
 * Returns whether the person had a connection with that client.
 */
export async function revokeConnection(db: Database, userId: string, clientId: string): Promise<boolean> {
  const [consent] = await db
    .select({ id: oauthConsent.id })
    .from(oauthConsent)
    .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
    .limit(1);
  if (!consent) return false;
  // Access tokens first: they point at their refresh token.
  await db.batch([
    db.delete(oauthAccessToken).where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId))),
    db.delete(oauthRefreshToken).where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId))),
    db.delete(oauthConsent).where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId))),
  ]);
  return true;
}

/** The latest tool calls on the account, newest first, with the name of the app that made each. */
export async function recentActivity(
  db: Database,
  userId: string,
  limit: number,
  clientId?: string,
): Promise<ActivityView[]> {
  const rows = await db
    .select({
      id: mcpAudit.id,
      clientId: mcpAudit.clientId,
      clientName: oauthClient.name,
      tool: mcpAudit.tool,
      args: mcpAudit.args,
      outcome: mcpAudit.outcome,
      ms: mcpAudit.ms,
      createdAt: mcpAudit.createdAt,
    })
    .from(mcpAudit)
    .leftJoin(oauthClient, eq(oauthClient.clientId, mcpAudit.clientId))
    .where(clientId ? and(eq(mcpAudit.userId, userId), eq(mcpAudit.clientId, clientId)) : eq(mcpAudit.userId, userId))
    .orderBy(desc(mcpAudit.createdAt))
    .limit(limit);
  return rows;
}

/** Whether the person still has an active consent for the client (a revoked connection fails at once). */
export async function hasActiveConnection(db: Database, userId: string, clientId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: oauthConsent.id, disabled: oauthClient.disabled })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
    .limit(1);
  return row !== undefined && !row.disabled;
}

/** Tool calls the account made since `sinceMs`; the daily cap reads this. */
export async function countCalls(db: Database, userId: string, sinceMs: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(mcpAudit)
    .where(and(eq(mcpAudit.userId, userId), gte(mcpAudit.createdAt, sinceMs)));
  return row?.total ?? 0;
}

export interface AuditEntry {
  userId: string;
  clientId: string;
  tool: string;
  args: unknown;
  outcome: "ok" | "error" | "not_pro" | "rate_limited" | "scope";
  ms: number;
}

/** Keeps the arguments short: they are dates and ids, so this only guards against a client stuffing text in. */
function argsText(args: unknown): string | null {
  if (args === undefined || args === null) return null;
  const text = JSON.stringify(args);
  if (!text || text === "{}") return null;
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

export async function writeAudit(db: Database, entry: AuditEntry, now = Date.now()): Promise<void> {
  await db.insert(mcpAudit).values({
    id: crypto.randomUUID(),
    userId: entry.userId,
    clientId: entry.clientId,
    tool: entry.tool,
    args: argsText(entry.args),
    outcome: entry.outcome,
    ms: Math.max(0, Math.round(entry.ms)),
    createdAt: now,
  });
}

/**
 * Cron housekeeping: audit rows older than the retention, and dynamically registered clients nobody ever consented to
 * (registration needs no account, so an abandoned or scripted one must not pile up). Deletes in small batches.
 */
export async function sweepMcp(db: Database, now = Date.now()): Promise<{ audit: number; clients: number }> {
  const auditCut = now - MCP_AUDIT_RETENTION_DAYS * DAY_MS;
  const stale = await db.select({ id: mcpAudit.id }).from(mcpAudit).where(lt(mcpAudit.createdAt, auditCut)).limit(200);
  for (const ids of chunk(
    stale.map((row) => row.id),
    D1_MAX_PARAMS,
  )) {
    await db.delete(mcpAudit).where(inArray(mcpAudit.id, ids));
  }
  // A client with no consent that is more than two days old and holds no token.
  const abandoned = await db
    .select({ clientId: oauthClient.clientId })
    .from(oauthClient)
    .where(
      and(
        lt(oauthClient.createdAt, new Date(now - 2 * DAY_MS)),
        sql`not exists (select 1 from ${oauthConsent} where ${oauthConsent.clientId} = ${oauthClient.clientId})`,
        sql`not exists (select 1 from ${oauthRefreshToken} where ${oauthRefreshToken.clientId} = ${oauthClient.clientId})`,
        sql`not exists (select 1 from ${oauthAccessToken} where ${oauthAccessToken.clientId} = ${oauthClient.clientId})`,
      ),
    )
    .limit(100);
  if (abandoned.length > 0) {
    const [first, ...rest] = chunk(
      abandoned.map((row) => row.clientId),
      D1_MAX_PARAMS,
    ).flatMap((ids) => [
      db.delete(oauthClientResource).where(inArray(oauthClientResource.clientId, ids)),
      db.delete(oauthClient).where(inArray(oauthClient.clientId, ids)),
    ]);
    await db.batch([first!, ...rest]);
  }
  return { audit: stale.length, clients: abandoned.length };
}

/**
 * Statements that remove every connection and audit row of a user: the account wipe runs them with the rest of the
 * personal data, so a wiped account is not left connected to an assistant that now reads nothing.
 */
export function deleteUserMcpData(db: Database, userId: string) {
  return [
    db.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, userId)),
    db.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, userId)),
    db.delete(oauthConsent).where(eq(oauthConsent.userId, userId)),
    db.delete(mcpAudit).where(eq(mcpAudit.userId, userId)),
  ] as const;
}
