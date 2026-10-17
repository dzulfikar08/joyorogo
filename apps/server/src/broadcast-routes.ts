import { eq, sql } from "drizzle-orm";
import type { JoyoAuth } from "@joyorogo/auth";
import type { Context, Hono } from "hono";
import { z } from "zod";

import type { Database } from "@joyorogo/db";
import { user } from "@joyorogo/db/schema/auth";

import { BATCH_LIMIT, CAMPAIGN_ID_RE, RecipientCountChanged, broadcastStatus, renderFor, sendBroadcast, sendBroadcastTest } from "./broadcast";
import type { BroadcastDeps } from "./broadcast";
import { BROADCAST_SENDER, DEFAULT_CAMPAIGN } from "./broadcast-campaign";

type Deps = {
  /** Comma-separated ADMIN_EMAILS: the only inboxes a test mail may go to. */
  adminEmails: string | undefined;
  getDb: () => Database;
  createAuth: () => Promise<JoyoAuth>;
  /** Missing STICKERS bucket (opt-outs, state) = broadcast off. */
  broadcast: () => BroadcastDeps | undefined;
  /** BROADCAST_KEY secret for the CLI routes under /ai/broadcast; unset = they answer 404. */
  key: string | undefined;
};

const campaignShape = {
  id: z.string().regex(CAMPAIGN_ID_RE, "id: a-z, 0-9 and -, 3 to 40 characters"),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
};
const campaignSchema = z.object(campaignShape);
const previewSchema = z.object({ subject: campaignShape.subject, body: campaignShape.body });
const sendSchema = campaignSchema.extend({ expected: z.number().int().min(0) });
const cliTestSchema = z
  .object({ to: z.string().email().optional(), id: campaignShape.id, subject: campaignShape.subject, body: campaignShape.body })
  .partial();

async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S> | Response> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue?.path.join(".");
  return c.json({ error: `${field ? `${field}: ` : ""}${issue?.message ?? "invalid body"}` }, 400);
}

const isResponse = (value: unknown): value is Response => value instanceof Response;

/**
 * Announcement mail for the admin console (/api/admin/broadcast/*, behind the
 * ADMIN_EMAILS session gate that registerAdminRoutes installs) plus two
 * key-gated CLI routes for a test send and the recipient counts. Sending to
 * everyone has no key route on purpose: it is only reachable from the console.
 */
export function registerBroadcastRoutes(app: Hono, deps: Deps) {
  const admins = new Set(
    (deps.adminEmails ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );

  const unavailable = (c: Context) => c.json({ error: "broadcast off (no STICKERS bucket)" }, 503);

  app.get("/api/admin/broadcast", (c) =>
    c.json({
      campaign: DEFAULT_CAMPAIGN,
      sender: BROADCAST_SENDER,
      batchLimit: BATCH_LIMIT,
    }),
  );

  app.get("/api/admin/broadcast/status", async (c) => {
    const id = c.req.query("id") ?? "";
    if (!CAMPAIGN_ID_RE.test(id)) return c.json({ error: "id: invalid campaign id" }, 400);
    const broadcast = deps.broadcast();
    if (!broadcast) return unavailable(c);
    return c.json(await broadcastStatus(broadcast, id));
  });

  // Rendered exactly as it will be mailed, for a sample recipient (the signed-in admin).
  app.post("/api/admin/broadcast/preview", async (c) => {
    const body = await parseJson(c, previewSchema);
    if (isResponse(body)) return body;
    const broadcast = deps.broadcast();
    if (!broadcast) return unavailable(c);
    const me = (await (await deps.createAuth()).api.getSession({ headers: c.req.raw.headers }))!.user;
    const { mail } = await renderFor(broadcast, { id: DEFAULT_CAMPAIGN.id, ...body }, me);
    return c.json(mail);
  });

  // One real mail to the signed-in admin, logged in email_log as broadcast_test:<id>.
  app.post("/api/admin/broadcast/test", async (c) => {
    const body = await parseJson(c, campaignSchema);
    if (isResponse(body)) return body;
    const broadcast = deps.broadcast();
    if (!broadcast) return unavailable(c);
    const me = (await (await deps.createAuth()).api.getSession({ headers: c.req.raw.headers }))!.user;
    const result = await sendBroadcastTest(broadcast, body, me);
    return c.json(result, result.ok ? 200 : 502);
  });

  // Starts or resumes the full send and mails one batch; the console repeats it until nothing remains.
  app.post("/api/admin/broadcast/send", async (c) => {
    const body = await parseJson(c, sendSchema);
    if (isResponse(body)) return body;
    const broadcast = deps.broadcast();
    if (!broadcast) return unavailable(c);
    const { expected, ...campaign } = body;
    try {
      return c.json(await sendBroadcast(broadcast, campaign, expected));
    } catch (error) {
      if (error instanceof RecipientCountChanged) {
        return c.json({ error: `Jumlah penerima berubah: sekarang ${error.current}`, current: error.current }, 409);
      }
      throw error;
    }
  });

  // --- CLI (X-Broadcast-Key) --------------------------------------------------------
  const keyed = (c: Context) => Boolean(deps.key) && c.req.header("X-Broadcast-Key") === deps.key;

  // Counts only; no mail.
  app.get("/ai/broadcast/status", async (c) => {
    if (!keyed(c)) return c.text("Not Found", 404);
    const broadcast = deps.broadcast();
    if (!broadcast) return unavailable(c);
    return c.json(await broadcastStatus(broadcast, c.req.query("id") ?? DEFAULT_CAMPAIGN.id));
  });

  // One test mail to an ADMIN_EMAILS inbox (default: the first), never to anyone else.
  app.post("/ai/broadcast/test", async (c) => {
    if (!keyed(c)) return c.text("Not Found", 404);
    const body = await parseJson(c, cliTestSchema);
    if (isResponse(body)) return body;
    const to = (body.to ?? [...admins][0] ?? "").toLowerCase();
    if (!admins.has(to)) return c.json({ error: "to must be one of ADMIN_EMAILS" }, 403);
    const broadcast = deps.broadcast();
    if (!broadcast) return unavailable(c);
    const [recipient] = await deps
      .getDb()
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(sql`lower(${user.email})`, to))
      .limit(1);
    if (!recipient) return c.json({ error: "no user with that email (email_log needs one)" }, 404);
    const campaign = {
      id: body.id ?? DEFAULT_CAMPAIGN.id,
      subject: body.subject ?? DEFAULT_CAMPAIGN.subject,
      body: body.body ?? DEFAULT_CAMPAIGN.body,
    };
    const result = await sendBroadcastTest(broadcast, campaign, recipient);
    return c.json({ to: recipient.email, ...result }, result.ok ? 200 : 502);
  });
}
