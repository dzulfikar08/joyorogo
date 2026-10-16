import { ORPCError } from "@orpc/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { exerciseLog, profile, weightLog } from "@joyorogo/db/schema/fitness";

import type { Context } from "../context";

import { protectedProcedure } from "../index";
import { estimateKcal, metForStravaType } from "../lib/met";
import {
  StravaGrantError,
  deleteImportedActivities,
  disconnectProduct,
  exchangeCode,
  freshAccessToken,
  grantStatus,
  isJoyofitUpload,
  stravaConfigured,
} from "../lib/strava-grant";

// protectedProcedure narrows session to non-null; helpers share that shape.
type AuthedContext = Context & { session: NonNullable<Context["session"]> };

const STRAVA_ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities?per_page=30";

// WIB calendar day of an ISO instant — same fixed UTC+7 rule as jakartaToday.
function wibDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

type StravaActivity = {
  id: number;
  type?: string;
  name?: string;
  start_date: string;
  moving_time?: number;
  calories?: number;
  // What the uploader gave Strava; JoyoFit's files start with `joyofit-`.
  external_id?: string;
};

function requireStravaConfig(context: Context): void {
  if (!stravaConfigured(context.env)) {
    throw new ORPCError("NOT_FOUND", {
      message: "Strava belum dikonfigurasi di server.",
    });
  }
}

const RECONNECT_MESSAGE = "Sambungan Strava ditolak. Hubungkan ulang di halaman profil.";
const RETRY_MESSAGE = "Gagal menghubungi Strava. Coba lagi nanti.";

/** Strava failures as the user should read them: only a refused grant may tell them to reconnect. */
function toOrpcError(error: unknown): ORPCError<string, unknown> {
  if (error instanceof StravaGrantError) {
    if (error.failure === "rejected") return new ORPCError("UNAUTHORIZED", { message: RECONNECT_MESSAGE });
    if (error.failure === "scope_missing") {
      return new ORPCError("BAD_REQUEST", {
        message: "Izinkan JoyoRogo membaca aktivitasmu di halaman Strava, lalu hubungkan lagi.",
      });
    }
  }
  return new ORPCError("INTERNAL_SERVER_ERROR", { message: RETRY_MESSAGE, cause: error });
}

async function getValidToken(context: AuthedContext): Promise<string> {
  let token;
  try {
    token = await freshAccessToken(context.db, context.env, context.session.user.id, "rogo");
  } catch (error) {
    throw toOrpcError(error);
  }
  if (!token) {
    throw new ORPCError("NOT_FOUND", {
      message: "Hubungkan Strava dulu di halaman profil.",
    });
  }
  return token.accessToken;
}

export const stravaRouter = {
  status: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const configured = stravaConfigured(context.env);
    const status = await grantStatus(context.db, userId, "rogo");
    // Nothing imported from Strava outlives the connection (Strava API policy), including when the
    // grant ended elsewhere (deauthorized on strava.com, refused refresh token).
    if (!status.connected) await deleteImportedActivities(context.db, userId);
    return {
      configured,
      connected: status.connected,
      athleteId: status.athleteId,
    };
  }),

  authorizeUrl: protectedProcedure
    .input(z.object({ redirectUri: z.string().url() }))
    .handler(async ({ context, input }) => {
      requireStravaConfig(context);
      const { requestedScope: scope } = await grantStatus(context.db, context.session.user.id, "rogo");
      const url = new URL("https://www.strava.com/oauth/authorize");
      url.searchParams.set("client_id", context.env.STRAVA_CLIENT_ID ?? "");
      url.searchParams.set("redirect_uri", input.redirectUri);
      url.searchParams.set("response_type", "code");
      // JoyoRogo's own scopes plus whatever is already granted, so connecting here never narrows a
      // grant JoyoFit uploads with (docs/strava.md).
      url.searchParams.set("scope", scope);
      url.searchParams.set("approval_prompt", "auto");
      return { url: url.toString() };
    }),

  exchangeCode: protectedProcedure
    .input(z.object({ code: z.string().min(1), redirectUri: z.string().url() }))
    .handler(async ({ context, input }) => {
      requireStravaConfig(context);
      try {
        const { athleteId } = await exchangeCode(context.db, context.env, {
          userId: context.session.user.id,
          product: "rogo",
          code: input.code,
        });
        return { connected: true, athleteId };
      } catch (error) {
        throw toOrpcError(error);
      }
    }),

  // Strava API policy notes for imported rows (exercise_log.source = 'strava'):
  // owner-only display (excluded from groups, challenges, feed and shares), never
  // sent to AI, not used in adaptive-plan analytics. The 7-day cache cap (6.2) is
  // NOT enforced yet: rows persist until disconnect.
  sync: protectedProcedure.handler(async ({ context }) => {
    const accessToken = await getValidToken(context);
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
        message: RETRY_MESSAGE,
      });
    }
    const activities = (await res.json()) as StravaActivity[];
    // A workout JoyoFit uploaded reaches the diary through Health Connect / Apple Health
    // (source health_connect / apple_health); importing it from Strava too would count it twice.
    const imports = activities.filter((activity) => !isJoyofitUpload(activity.external_id));

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

    const statements = imports.map((activity) => {
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

  // Strava API policy: on disconnect the imported Strava activities go with the
  // connection. The grant itself is revoked at Strava only when JoyoFit is not
  // using it either (lib/strava-grant disconnectProduct).
  disconnect: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    await disconnectProduct(context.db, context.env, userId, "rogo");
    await deleteImportedActivities(context.db, userId);
    return { connected: false };
  }),
};
