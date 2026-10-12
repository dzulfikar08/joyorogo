import { ORPCError } from "@orpc/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { exerciseLog, profile, stravaAccount, weightLog } from "@joyorogo/db/schema/fitness";

import type { Context } from "../context";

import { protectedProcedure } from "../index";
import { estimateKcal, metForStravaType } from "../lib/met";

// protectedProcedure narrows session to non-null; helpers share that shape.
type AuthedContext = Context & { session: NonNullable<Context["session"]> };

const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities?per_page=30";
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

// WIB calendar day of an ISO instant — same fixed UTC+7 rule as jakartaToday.
function wibDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

type StravaTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete: { id: number };
};

type StravaActivity = {
  id: number;
  type?: string;
  name?: string;
  start_date: string;
  moving_time?: number;
  calories?: number;
};

async function stravaTokenFetch(
  body: Record<string, string | undefined>,
): Promise<StravaTokenResponse> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // 400/401: the grant (auth code or refresh token) is invalid or revoked —
    // only then may the user be told to reconnect. Anything else is transient.
    if (res.status === 400 || res.status === 401) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Sambungan Strava ditolak. Hubungkan ulang di halaman profil.",
      });
    }
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Gagal menghubungi Strava. Coba lagi nanti.",
    });
  }
  try {
    const token = (await res.json()) as StravaTokenResponse;
    if (!token.access_token) {
      throw new Error("missing access_token");
    }
    return token;
  } catch {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Strava memberi jawaban tak terduga. Coba lagi nanti.",
    });
  }
}

async function getValidToken(
  context: AuthedContext,
): Promise<{ accessToken: string; athleteId: string }> {
  const [row] = await context.db
    .select()
    .from(stravaAccount)
    .where(eq(stravaAccount.userId, context.session.user.id));
  if (!row) {
    throw new ORPCError("NOT_FOUND", {
      message: "Hubungkan Strava dulu di halaman profil.",
    });
  }
  if (row.expiresAt.getTime() > Date.now() + TOKEN_EXPIRY_MARGIN_MS) {
    return { accessToken: row.accessToken, athleteId: row.athleteId };
  }
  try {
    const token = await stravaTokenFetch({
      client_id: context.env.STRAVA_CLIENT_ID,
      client_secret: context.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: row.refreshToken,
    });
    await context.db
      .update(stravaAccount)
      .set({
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(token.expires_at * 1000),
      })
      .where(eq(stravaAccount.userId, context.session.user.id));
    return { accessToken: token.access_token, athleteId: row.athleteId };
  } catch (error) {
    // Strava rotates refresh tokens: a concurrent request may have refreshed
    // first and invalidated ours. Re-read before failing the user out.
    const [fresh] = await context.db
      .select()
      .from(stravaAccount)
      .where(eq(stravaAccount.userId, context.session.user.id));
    if (
      fresh &&
      fresh.accessToken !== row.accessToken &&
      fresh.expiresAt.getTime() > Date.now() + TOKEN_EXPIRY_MARGIN_MS
    ) {
      return { accessToken: fresh.accessToken, athleteId: fresh.athleteId };
    }
    // Grant rejections keep their reconnect guidance; transient failures keep
    // theirs (network errors get the generic retry copy, never "reconnect").
    if (error instanceof ORPCError) {
      throw error;
    }
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Gagal menghubungi Strava. Coba lagi nanti.",
      cause: error,
    });
  }
}

function requireStravaConfig(context: Context): { clientId: string; clientSecret: string } {
  const clientId = context.env.STRAVA_CLIENT_ID;
  const clientSecret = context.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new ORPCError("NOT_FOUND", {
      message: "Strava belum dikonfigurasi di server.",
    });
  }
  return { clientId, clientSecret };
}

export const stravaRouter = {
  status: protectedProcedure.handler(async ({ context }) => {
    const configured = Boolean(context.env.STRAVA_CLIENT_ID && context.env.STRAVA_CLIENT_SECRET);
    const [row] = await context.db
      .select({ athleteId: stravaAccount.athleteId })
      .from(stravaAccount)
      .where(eq(stravaAccount.userId, context.session.user.id));
    return {
      configured,
      connected: Boolean(row),
      athleteId: row?.athleteId,
    };
  }),

  authorizeUrl: protectedProcedure
    .input(z.object({ redirectUri: z.string().url() }))
    .handler(({ context, input }) => {
      const { clientId } = requireStravaConfig(context);
      const url = new URL("https://www.strava.com/oauth/authorize");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", input.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "read,activity:read_all");
      url.searchParams.set("approval_prompt", "auto");
      return { url: url.toString() };
    }),

  exchangeCode: protectedProcedure
    .input(z.object({ code: z.string().min(1), redirectUri: z.string().url() }))
    .handler(async ({ context, input }) => {
      const { clientId, clientSecret } = requireStravaConfig(context);
      const token = await stravaTokenFetch({
        client_id: clientId,
        client_secret: clientSecret,
        code: input.code,
        grant_type: "authorization_code",
      });
      const athleteId = String(token.athlete.id);
      await context.db
        .insert(stravaAccount)
        .values({
          userId: context.session.user.id,
          athleteId,
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          expiresAt: new Date(token.expires_at * 1000),
        })
        .onConflictDoUpdate({
          target: stravaAccount.userId,
          set: {
            athleteId,
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            expiresAt: new Date(token.expires_at * 1000),
          },
        });
      return { connected: true, athleteId };
    }),

  sync: protectedProcedure.handler(async ({ context }) => {
    const { accessToken } = await getValidToken(context);
    const res = await fetch(STRAVA_ACTIVITIES_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) {
      throw new ORPCError("UNAUTHORIZED", {
        message: "Sambungan Strava kedaluwarsa. Hubungkan ulang di halaman profil.",
      });
    }
    if (!res.ok) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Gagal menghubungi Strava. Coba lagi nanti.",
      });
    }
    const activities = (await res.json()) as StravaActivity[];

    // One weight query for the whole batch instead of two per activity.
    const [weights, profileRows] = await Promise.all([
      context.db
        .select({ date: weightLog.date, weightKg: weightLog.weightKg })
        .from(weightLog)
        .where(eq(weightLog.userId, context.session.user.id))
        .orderBy(asc(weightLog.date)),
      context.db
        .select({ startWeightKg: profile.startWeightKg })
        .from(profile)
        .where(eq(profile.userId, context.session.user.id)),
    ]);
    const fallbackKg = profileRows[0]?.startWeightKg ?? 70;
    const weightAt = (date: string): number => {
      let latest: number | undefined;
      for (const w of weights) {
        if (w.date > date) break;
        latest = w.weightKg;
      }
      return latest ?? fallbackKg;
    };

    const statements = activities.map((activity) => {
      const date = wibDate(activity.start_date);
      const durationMin = (activity.moving_time ?? 0) / 60;
      const kcal =
        activity.calories && activity.calories > 0
          ? Math.round(activity.calories)
          : estimateKcal(metForStravaType(activity.type ?? ""), weightAt(date), durationMin);
      return context.db
        .insert(exerciseLog)
        .values({
          id: crypto.randomUUID(),
          userId: context.session.user.id,
          date,
          type: activity.type ?? null,
          name: activity.name ?? "Aktivitas Strava",
          durationMin,
          kcal,
          source: "strava",
          externalId: String(activity.id),
        })
        .onConflictDoNothing({
          target: [exerciseLog.userId, exerciseLog.source, exerciseLog.externalId],
        })
        .returning({ id: exerciseLog.id });
    });
    let imported = 0;
    if (statements.length > 0) {
      // The guard guarantees ≥1 statement; drizzle's tuple type can't see it.
      const results = await context.db.batch(
        statements as [(typeof statements)[number], ...(typeof statements)[number][]],
      );
      imported = results.filter((rows) => rows.length > 0).length;
    }
    return { imported, skipped: activities.length - imported };
  }),

  disconnect: protectedProcedure.handler(async ({ context }) => {
    await context.db.delete(stravaAccount).where(eq(stravaAccount.userId, context.session.user.id));
    return { connected: false };
  }),
};
