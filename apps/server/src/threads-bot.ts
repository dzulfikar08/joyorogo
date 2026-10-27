import { eq } from "drizzle-orm";
import type { JoyoAuth } from "@joyorogo/auth";
import type { Context, Hono } from "hono";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import { threadsAccount } from "@joyorogo/db/schema/threads";
import type { BotConfig } from "@joyorogo/api/lib/threads-bot/config";
import {
  createConnectState,
  parseSignedRequest,
  verifyConnectState,
} from "@joyorogo/api/lib/threads-bot/connect";
import { authorizeUrl, exchangeCode } from "@joyorogo/api/lib/threads-bot/graph";
import {
  approveDraft,
  editDraft,
  liveSource,
  pollMentions,
  processMention,
  rejectDraft,
  sweepReceived,
} from "@joyorogo/api/lib/threads-bot/pipeline";
import type { BotDeps } from "@joyorogo/api/lib/threads-bot/pipeline";
import { replyTextProblem } from "@joyorogo/api/lib/threads-bot/reply";
import { listByStatus, parseDishes, todayCounts } from "@joyorogo/api/lib/threads-bot/store";
import type { MentionRow, MentionStatus } from "@joyorogo/api/lib/threads-bot/store";
import {
  ensureAccount,
  readAccount,
  saveConnectedToken,
} from "@joyorogo/api/lib/threads-bot/token";
import {
  parseMentionEvents,
  verifyChallenge,
  verifySignature,
} from "@joyorogo/api/lib/threads-bot/webhook";

type Deps = {
  getDb: () => Database;
  /** Settings parsed from the env (lib/threads-bot/config.ts); read per request. */
  config: () => BotConfig;
  /** The app's photo scan on one image; production wires analyzeFoodPhoto with the Workers AI binding. */
  scan: BotDeps["scan"];
  createAuth: () => Promise<JoyoAuth>;
  /** BETTER_AUTH_SECRET: signs the Connect `state`. */
  stateSecret: string;
  /** Origin of the admin console the Connect flow returns to. */
  adminUrl?: string;
  now?: () => number;
  /** Wait before the one retry of a failed threads_publish; tests shorten it. */
  publishRetryMs?: number;
};

const DEFAULT_ADMIN_URL = "https://admin.joyorogo.com";
const LIST_LIMIT = 50;

const textBody = z.object({ text: z.string() });
const approveBody = z.object({ text: z.string().optional() });

const VIEWS: Record<string, readonly MentionStatus[]> = {
  pending: ["pending_review", "publishing"],
  sent: ["sent"],
  other: ["skipped", "rejected", "failed", "received", "scanning"],
};

/** A row as the admin console reads it. The photo and permalink are not here: they are fetched live from Threads. */
function present(row: MentionRow) {
  return {
    mediaId: row.mediaId,
    author: row.authorUsername,
    status: row.status,
    skipReason: row.skipReason,
    kind: row.kind,
    dishes: parseDishes(row.dishesJson),
    kcalLow: row.kcalLow,
    kcalHigh: row.kcalHigh,
    replyText: row.replyText,
    mode: row.mode,
    replyMediaId: row.replyMediaId,
    error: row.error,
    reviewedBy: row.reviewedBy,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
  };
}

/**
 * Threads mention bot routes (docs/threads-bot.md): Meta's webhook and OAuth redirect (public, each authenticated by its
 * own signature or state), and the admin console's queue under /api/admin/threads-bot (behind the ADMIN_EMAILS gate that
 * registerAdminRoutes installs, so this registers after it).
 */
export function registerThreadsBotRoutes(app: Hono, deps: Deps) {
  const now = () => (deps.now ?? Date.now)();
  const botDeps = (): BotDeps => ({
    db: deps.getDb(),
    config: deps.config(),
    scan: deps.scan,
    now: deps.now,
    publishRetryMs: deps.publishRetryMs,
  });
  const adminUrl = () => (deps.adminUrl ?? DEFAULT_ADMIN_URL).replace(/\/+$/, "");

  /** Work that outlives the response (Meta wants the 200 fast): waitUntil on a Worker, awaited where there is no execution context. */
  const defer = async (c: Context, work: Promise<unknown>) => {
    try {
      c.executionCtx.waitUntil(work);
    } catch {
      await work;
    }
  };

  const reviewer = async (c: Context) =>
    (await (await deps.createAuth()).api.getSession({ headers: c.req.raw.headers }))?.user.email ??
    "admin";

  // ---- Meta -> us

  app.get("/api/threads/webhook", (c) => {
    const { verifyToken } = deps.config();
    if (!verifyToken) return c.json({ error: "threads webhook not configured" }, 503);
    const challenge = verifyChallenge(c.req.query(), verifyToken);
    return challenge === null ? c.json({ error: "forbidden" }, 403) : c.text(challenge);
  });

  app.post("/api/threads/webhook", async (c) => {
    const config = deps.config();
    if (config.signingSecrets.length === 0) return c.json({ error: "threads webhook not configured" }, 503);
    const raw = await c.req.text();
    const signature = c.req.header("x-hub-signature-256");
    const checks = await Promise.all(config.signingSecrets.map((secret) => verifySignature(secret, raw, signature)));
    if (!checks.some(Boolean)) return c.json({ error: "bad signature" }, 401);
    // Kill switch: acknowledge so Meta does not retry, handle nothing.
    if (config.mode === "off") return c.json({ ok: true, mode: "off" });
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ error: "bad json" }, 400);
    }
    const account = await readAccount(deps.getDb());
    const events = parseMentionEvents(payload).filter(
      (event) =>
        !event.targetId || !account?.threadsUserId || event.targetId === account.threadsUserId,
    );
    await defer(
      c,
      (async () => {
        for (const event of events) {
          await processMention(botDeps(), event.post).catch((error: unknown) =>
            console.error("[threads-bot] webhook mention failed", event.post.id, error),
          );
        }
      })(),
    );
    return c.json({ ok: true, mentions: events.length });
  });

  // Meta's OAuth redirect. Public, but it does nothing without a `state` only an admin could have minted.
  app.get("/api/threads/callback", async (c) => {
    const config = deps.config();
    const back = (query: string) => c.redirect(`${adminUrl()}/#threads${query}`, 302);
    const { code, state, error } = c.req.query();
    if (error || !code || !state) return back(`?error=${encodeURIComponent(error ?? "no_code")}`);
    if (!config.appId || !config.appSecret) return back("?error=not_configured");
    if (!(await verifyConnectState(deps.stateSecret, state, now())))
      return back("?error=state_expired");
    try {
      const token = await exchangeCode(config.appId, config.appSecret, config.redirectUri, code);
      await saveConnectedToken(deps.getDb(), token, now());
    } catch (cause) {
      console.error("[threads-bot] connect failed", cause);
      return back("?error=exchange_failed");
    }
    return back("?connected=1");
  });

  // Meta's required "deauthorize" and "data deletion" callbacks. The only account that authorizes this app is our own
  // brand account, so both forget its token; the response of the deletion request carries the status page Meta shows.
  const signedRequestRoute = (path: string, respond: (userId: string) => unknown) =>
    app.post(path, async (c) => {
      const { signingSecrets } = deps.config();
      if (signingSecrets.length === 0) return c.json({ error: "threads not configured" }, 503);
      const form = await c.req.parseBody();
      const signed = typeof form.signed_request === "string" ? form.signed_request : "";
      const parsed = (await Promise.all(signingSecrets.map((secret) => parseSignedRequest(secret, signed)))).find(Boolean);
      if (!parsed) return c.json({ error: "bad signed_request" }, 400);
      const db = deps.getDb();
      const account = await readAccount(db);
      if (account?.threadsUserId === parsed.userId)
        await db.delete(threadsAccount).where(eq(threadsAccount.id, 1));
      return c.json(respond(parsed.userId));
    });
  signedRequestRoute("/api/threads/deauthorize", () => ({ ok: true }));
  signedRequestRoute("/api/threads/delete", (userId) => ({
    url: `${deps.config().siteUrl}/privasi`,
    confirmation_code: userId,
  }));

  // ---- admin console

  app.get("/api/admin/threads-bot", async (c) => {
    const config = deps.config();
    const db = deps.getDb();
    const account = await readAccount(db);
    return c.json({
      mode: config.mode,
      caps: { user: config.userCap, global: config.globalCap },
      band: config.band,
      configured: {
        app: Boolean(config.appId && config.appSecret),
        webhook: Boolean(config.appSecret && config.verifyToken),
        seed: Boolean(config.seedToken),
      },
      redirectUri: config.redirectUri,
      webhookUrl: config.redirectUri.replace(/\/callback$/, "/webhook"),
      account: account && {
        username: account.username,
        source: account.source,
        status: account.status,
        expiresAt: account.expiresAt,
        refreshedAt: account.refreshedAt,
        lastPolledAt: account.lastPolledAt,
        lastError: account.lastError,
      },
      today: await todayCounts(db, now()),
    });
  });

  app.get("/api/admin/threads-bot/connect", async (c) => {
    const { appId, redirectUri, appSecret } = deps.config();
    if (!appId || !appSecret)
      return c.json({ error: "THREADS_APP_ID and THREADS_APP_SECRET are not set" }, 503);
    return c.json({
      url: authorizeUrl(appId, redirectUri, await createConnectState(deps.stateSecret, now())),
    });
  });

  app.get("/api/admin/threads-bot/mentions", async (c) => {
    const view = c.req.query("view") ?? "pending";
    const statuses = VIEWS[view];
    if (!statuses) return c.json({ error: `view: one of ${Object.keys(VIEWS).join(", ")}` }, 400);
    const db = deps.getDb();
    const rows = await listByStatus(db, statuses, LIST_LIMIT);
    // The photo and permalink of a queued draft come live from Threads, in parallel; a failure leaves them empty.
    const account =
      view === "pending"
        ? await ensureAccount(db, deps.config().seedToken, now()).catch(() => null)
        : null;
    const items = await Promise.all(
      rows.map(async (row) => ({
        ...present(row),
        ...(account && row.sourceMediaId
          ? await liveSource(account.token, row.sourceMediaId)
          : { photoUrl: null, permalink: null }),
      })),
    );
    return c.json({ items });
  });

  app.patch("/api/admin/threads-bot/mentions/:id", async (c) => {
    const body = textBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "text: required" }, 400);
    const problem = replyTextProblem(body.data.text);
    if (problem) return c.json({ error: problem }, 400);
    const saved = await editDraft(deps.getDb(), c.req.param("id"), body.data.text, now());
    return saved ? c.json({ ok: true }) : c.json({ error: "not pending" }, 409);
  });

  app.post("/api/admin/threads-bot/mentions/:id/approve", async (c) => {
    const body = approveBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "text: must be a string" }, 400);
    if (body.data.text !== undefined) {
      const problem = replyTextProblem(body.data.text);
      if (problem) return c.json({ error: problem }, 400);
    }
    const outcome = await approveDraft(
      botDeps(),
      c.req.param("id"),
      await reviewer(c),
      body.data.text,
    );
    if (outcome === "off") return c.json({ error: "THREADS_BOT_MODE is off" }, 409);
    if (outcome === "no_token")
      return c.json({ error: "no Threads token: connect the account first" }, 409);
    if (outcome === "not_pending") return c.json({ error: "not pending" }, 409);
    if (outcome.status === "sent") return c.json({ ok: true, replyId: outcome.replyId });
    return c.json({ error: outcome.status === "failed" ? outcome.error : "not sent" }, 502);
  });

  app.post("/api/admin/threads-bot/mentions/:id/reject", async (c) => {
    const rejected = await rejectDraft(deps.getDb(), c.req.param("id"), await reviewer(c), now());
    return rejected ? c.json({ ok: true }) : c.json({ error: "not pending" }, 409);
  });

  // Same work as the cron tick, on demand: useful right after connecting, before Meta's webhook is live.
  app.post("/api/admin/threads-bot/poll", async (c) => c.json(await runThreadsBotTick(botDeps())));
}

/**
 * The 5-minute cron: keeps the token fresh (even with the bot off, so a pause does not let it lapse), then polls the
 * mentions edge and finishes anything left half done. Never throws.
 */
export async function runThreadsBotTick(
  deps: BotDeps,
): Promise<{ polled: number; handled: number; swept: number }> {
  const at = (deps.now ?? Date.now)();
  const result = { polled: 0, handled: 0, swept: 0 };
  try {
    await ensureAccount(deps.db, deps.config.seedToken, at);
    Object.assign(result, await pollMentions(deps));
    result.swept = await sweepReceived(deps);
  } catch (error) {
    console.error("[threads-bot] tick failed", error);
  }
  return result;
}
